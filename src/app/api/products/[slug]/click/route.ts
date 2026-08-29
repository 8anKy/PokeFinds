import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { cachedRead, STATIC_CACHE_TAG } from "@/lib/cache";
import { clientIp } from "@/lib/client-ip";
import { readJsonCapped } from "@/lib/body-limit";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { flushAnalyticsEvents, trackEvent } from "@/services/analytics";
import { loadProductDetail } from "@/services/products";

export const dynamic = "force-dynamic";

/**
 * Hårt body-tak. Kroppen är ETT offer-id — några kB räcker med bred marginal, och
 * taket verkställs medan strömmen läses (`req.json()` buffrar allt först).
 * ⚠️ `readJsonCapped` formulerar sitt 413-meddelande i MB (den byggdes för
 * bilduppladdningar) → ett tak på 4 kB hade blivit "max 0 MB". Meddelandet skrivs
 * därför om nedan; statuskoden är oförändrad.
 */
const MAX_BODY_BYTES = 4 * 1024;

// Generöst tak: en användare som jämför butiker klickar sig igenom en handfull
// länkar per minut. Taket finns för att en loop inte ska kunna driva vare sig
// klickräknaren eller Neon-väckningarna.
const CLICK_RATE_LIMIT = 60;
const CLICK_RATE_WINDOW_MS = 60 * 1000;

const bodySchema = z.object({
  offerId: z.string().min(1, "offerId krävs."),
});

/** Bygger utgående URL med affiliate-parametrar om återförsäljaren har det aktiverat. */
function buildOutboundUrl(url: string, affiliateParams: string | null): string {
  if (!affiliateParams) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${affiliateParams.replace(/^[?&]/, "")}`;
}

/**
 * Säkerställer att Cardmarket-URL:er har ?language=1 (engelska annonser).
 * Redirect-URL:er via prices.pokemontcg.io kan inte få language-param
 * (de redirectar till CM utan att skicka vidare query-params), men direkta
 * CM-URL:er får filtret tillagt.
 */
function ensureCmLanguageFilter(url: string): string {
  if (!url.includes("cardmarket.com/")) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("language")) {
      parsed.searchParams.set("language", "1");
      return parsed.toString();
    }
  } catch {
    // malformed URL — return as-is
  }
  return url;
}

/**
 * Affiliate-parametrarna per butik, TTL-cachade.
 *
 * Den cachade produktdetaljen bär bara FLAGGAN `affiliateEnabled`, inte
 * parametersträngen — och strängen ändras bara när någon redigerar butiken i
 * /admin. En läsning per timme (delad av alla klick, alla produkter) i stället för
 * en join per klick. `STATIC_CACHE_TAG` för att posten inte innehåller någon
 * prisinformation och därför inte ska slängas när prisjobben invaliderar priserna.
 *
 * ⚠️ Läses ENDAST när butiken faktiskt har affiliate på — har ingen butik det (vilket
 * är läget i dag) rörs databasen aldrig härifrån. Inaktualiteten är samma dygnsklass
 * som `affiliateEnabled` i produktdetaljen redan har.
 */
const affiliateParamsByRetailer = cachedRead(
  async (): Promise<Record<string, string | null>> => {
    const rows = await prisma.retailer.findMany({
      where: { affiliateEnabled: true },
      select: { id: true, affiliateParams: true },
    });
    return Object.fromEntries(rows.map((r) => [r.id, r.affiliateParams]));
  },
  "clickAffiliateParams",
  3600,
  [STATIC_CACHE_TAG]
);

// ── BUFFRAT KLICKRÄKNANDE (kostnadskritiskt) ────────────────────────────────────
// `clickCount` är mjuk engagemangsstatistik, men skrevs med EN
// `product.update({ increment: 1 })` per klick — dvs en garanterad Neon-väckning på
// appens hetaste väg, och varje väckning debiteras med ett minsta fönster på 300 s.
// Räknarna summeras därför i processminnet och skrivs med EN tur till databasen när
// `CLICK_FLUSH_SIZE` olika produkter samlats eller `CLICK_FLUSH_MS` passerat.
// Samma avvägning (och samma tal) som `trackEvent`: en omstart tappar det som ligger
// obuffrat, vilket är acceptabelt för en räknare som inte rör priser, larm eller pengar.
// ⛔ Lägg aldrig tillbaka en skrivning per klick här.
// 30 min sedan 2026-08-29 (var 300 000 = exakt Neons minsta fönster — se
// services/analytics.ts för mätningen). ⛔ Två oberoende timers kan arma TVÅ
// fönster: därför tömmer den här även analytics-bufferten när den ändå har väckt
// databasen (`flushAnalyticsEvents` nedan) — ett klick lägger alltid en händelse i
// båda, så utan kopplingen hade samma klick kunnat betala två väckningar.
const CLICK_FLUSH_SIZE = Number(process.env.CLICK_FLUSH_SIZE ?? 50);
const CLICK_FLUSH_MS = Number(process.env.CLICK_FLUSH_MS ?? 1_800_000);

let clickBuffer = new Map<string, number>();
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let clickExitHooksInstalled = false;

async function flushClickCounts(): Promise<void> {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  if (clickBuffer.size === 0) return;
  // Töm FÖRE skrivningen — annars räknas klick som kommer in under en långsam
  // skrivning två gånger vid nästa tömning.
  const batch = clickBuffer;
  clickBuffer = new Map();
  try {
    // `updateMany`, inte `update`: en produkt som hunnit raderas ger 0 rader i
    // stället för P2025 — med `update` hade EN död produkt fällt hela transaktionen
    // och slängt alla andras räknare.
    await prisma.$transaction(
      [...batch].map(([productId, count]) =>
        prisma.product.updateMany({
          where: { id: productId },
          data: { clickCount: { increment: count } },
        })
      )
    );
  } catch (error) {
    // Räknaren får aldrig fälla utgången till butiken. Batchen släpps (se avvägningen
    // ovan) — att lägga tillbaka den hade gett en buffert som växer i all oändlighet
    // när databasen är nere.
    console.error("Kunde inte spara klickräknare:", error);
  }
  // Computen är vaken nu — låt spårningsbufferten åka med i samma fönster.
  await flushAnalyticsEvents();
}

function queueClick(productId: string): void {
  if (!clickExitHooksInstalled) {
    clickExitHooksInstalled = true;
    // Railway skickar SIGTERM vid deploy/omskalning → sista batchen hinner skrivas.
    const onExit = () => {
      void flushClickCounts();
    };
    process.once("beforeExit", onExit);
    process.once("SIGTERM", onExit);
    process.once("SIGINT", onExit);
  }
  clickBuffer.set(productId, (clickBuffer.get(productId) ?? 0) + 1);
  if (clickBuffer.size >= CLICK_FLUSH_SIZE) {
    void flushClickCounts();
    return;
  }
  if (!clickTimer) {
    clickTimer = setTimeout(() => {
      void flushClickCounts();
    }, CLICK_FLUSH_MS);
    // Timern får inte hålla processen vid liv — annars fyras aldrig `beforeExit`.
    clickTimer.unref?.();
  }
}

interface ResolvedOffer {
  productId: string;
  retailerId: string;
  url: string;
  affiliateEnabled: boolean;
}

/**
 * Slår upp erbjudandet i den REDAN CACHADE produktdetaljen först.
 *
 * `loadProductDetail` är samma `singleFlight(cachedRead(...))` som produktsidan
 * renderats ur, så ett klick från en nyss laddad sida träffar en varm cache och rör
 * inte Neon alls. Den gamla vägen (`offer.findUnique` med två joins) var en
 * garanterad väckning per butiksklick.
 *
 * DB-fallbacken är kvar med flit: cachen kan vara upp till en timme gammal, och en
 * offer som just raderats/flyttats får inte serveras som en död länk. Fallbacken
 * fångar också de erbjudanden som detaljen filtrerar bort (`isDirectOfferUrl`), så
 * routens acceptans är oförändrad.
 */
async function resolveOffer(slug: string, offerId: string): Promise<ResolvedOffer> {
  const detail = await loadProductDetail(slug);
  const cached = detail?.serializedOffers.find((o) => o.id === offerId);
  if (detail && cached) {
    return {
      productId: detail.id,
      retailerId: cached.retailer.id,
      url: cached.url,
      affiliateEnabled: cached.retailer.affiliateEnabled,
    };
  }

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      url: true,
      retailerId: true,
      product: { select: { id: true, slug: true } },
      retailer: { select: { affiliateEnabled: true } },
    },
  });
  if (!offer || offer.product.slug !== slug) {
    throw new ServiceError(404, "Erbjudandet hittades inte.");
  }
  return {
    productId: offer.product.id,
    retailerId: offer.retailerId,
    url: offer.url,
    affiliateEnabled: offer.retailer.affiliateEnabled,
  };
}

export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    // Routen är MEDVETET öppen för utloggade (vem som helst ska kunna gå till butiken)
    // → IP-broms i stället för inloggning, så att en loop varken kan blåsa upp
    // klickräknaren eller mala på databasen via cache-missar.
    const { ok } = await rateLimit(
      `offer-click:${clientIp(req)}`,
      CLICK_RATE_LIMIT,
      CLICK_RATE_WINDOW_MS
    );
    if (!ok) throw new ServiceError(429, "För många klick. Försök igen om en stund.");

    const raw = await readJsonCapped(req, MAX_BODY_BYTES).catch((err: unknown) => {
      if (err instanceof ServiceError && err.status === 413) {
        throw new ServiceError(413, "Förfrågan är för stor.");
      }
      throw err;
    });
    const { offerId } = bodySchema.parse(raw);

    const offer = await resolveOffer(params.slug, offerId);

    queueClick(offer.productId);
    await trackEvent("retailer_click", offer.productId, {
      retailerId: offer.retailerId,
      offerId,
    });

    let url = offer.url;
    if (offer.affiliateEnabled) {
      const byRetailer = await affiliateParamsByRetailer();
      url = buildOutboundUrl(url, byRetailer[offer.retailerId] ?? null);
    }

    // Cardmarket: säkerställ engelskt språkfilter
    url = ensureCmLanguageFilter(url);

    return jsonOk({ url });
  } catch (e) {
    return apiError(e);
  }
}
