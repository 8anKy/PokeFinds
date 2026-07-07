/**
 * Fynd-verifiering (Pro-only "Fynd"-feed).
 *
 * Fynd-feeden lyfter fram Tradera-annonser långt under sitt Cardmarket-pris — men
 * den lyfter DÄRMED fram de sämsta matchningarna (fel produkt = störst "rabatt"),
 * plus tomma/skadade varor och utgångna annonser. Bigram-matchningen kan inte skilja
 * mall-namngivna sealed-produkter åt ("Palkia VSTAR Premium" vs "Arceus VSTAR Premium").
 *
 * Kandidatmängden är LITEN (tiotal) → vi har råd med ett dyrt, exakt anrop per annons:
 * hämta Tradera-annonsens fulla beskrivning (GetItem) och låt Claude Haiku avgöra om det
 * VERKLIGEN är samma sealed produkt OCH att den är komplett/oöppnad/oskadad. Resultatet
 * cachas i DealCheck (per offer + pris) så vi bara omverifierar när priset ändras.
 *
 * Kräver TRADERA_APP_ID/TRADERA_APP_KEY + ANTHROPIC_API_KEY. Körs sist i tradera-sweepen.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { mapPool } from "@/lib/concurrency";
import { dealCandidateOffers, DEAL_MIN_DISCOUNT, DEAL_MAX_DISCOUNT } from "@/services/products";
import { traderaResetSearchUrl } from "@/jobs/tradera-sweep";
import { StockStatus } from "@prisma/client";

const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";
const VERIFY_MODEL = process.env.DEALS_VERIFY_MODEL ?? "claude-haiku-4-5-20251001";

/** Tradera-itemId ur en annons-URL (`/item/{cat}/{itemId}/slug`). Null om okänd form. */
export function extractTraderaItemId(url: string): string | null {
  const m = /\/item\/\d+\/(\d+)/.exec(url);
  return m ? m[1] : null;
}

/** Slår ihop delbesluten till ett fynd-verdikt. Ren → testbar. */
export function dealVerdict(v: {
  sameProduct: boolean;
  sealedComplete: boolean;
  ended: boolean;
  remaining: number;
}): boolean {
  return v.sameProduct && v.sealedComplete && !v.ended && v.remaining > 0;
}

interface TraderaItemDetail {
  title: string;
  description: string;
  ended: boolean;
  remaining: number;
  endsAt: Date | null;
  priceOre: number | null; // BuyItNowPrice × 100 (null om ej fast pris)
  url: string | null; // direkt annons-URL
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return "";
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hämtar en Tradera-annons fulla detaljer via PublicService.GetItem. */
export async function fetchTraderaItem(
  itemId: string,
  appId: string,
  appKey: string
): Promise<TraderaItemDetail | null> {
  const header = `<soap:Header><trad:AuthenticationHeader><trad:AppId>${appId}</trad:AppId><trad:AppKey>${appKey}</trad:AppKey></trad:AuthenticationHeader><trad:ConfigurationHeader><trad:Sandbox>0</trad:Sandbox><trad:MaxResultAge>0</trad:MaxResultAge></trad:ConfigurationHeader></soap:Header>`;
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com">${header}<soap:Body><trad:GetItem><trad:itemId>${itemId}</trad:itemId></trad:GetItem></soap:Body></soap:Envelope>`;
  const res = await fetch(`${PUBLIC_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/GetItem"` },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  if (xml.includes("<faultstring>")) return null;
  const endRaw = tag(xml, "EndDate");
  const endsAt = endRaw ? new Date(endRaw) : null;
  const bin = parseInt(tag(xml, "BuyItNowPrice") || "", 10);
  const rawUrl = tag(xml, "Url") || tag(xml, "ItemLink") || null;
  return {
    title: tag(xml, "ShortDescription"),
    description: tag(xml, "LongDescription"),
    ended: tag(xml, "Ended").toLowerCase() === "true",
    remaining: parseInt(tag(xml, "RemainingQuantity") || "1", 10) || 0,
    endsAt: endsAt && !isNaN(endsAt.getTime()) ? endsAt : null,
    priceOre: Number.isFinite(bin) && bin > 0 ? bin * 100 : null,
    url: rawUrl ? rawUrl.replace(/^http:\/\//, "https://") : null,
  };
}

const SYSTEM = [
  "Du verifierar om en svensk Tradera-annons är SAMMA Pokémon TCG sealed-produkt som en katalogpost.",
  "Avgör TVÅ saker:",
  "1. sameProduct — samma set + samma produkttyp + samma variant? Avvisa (false) BARA vid en KONKRET motsägelse:",
  "   - olika set/expansion (Prismatic Evolutions ≠ Evolutions, Stellar Crown ≠ Stellar Miracle),",
  "     ÄVEN när ena setnamnet innehåller det andra: Dragon Majesty (2018) ≠ Dragon (EX Dragon, 2003),",
  "     151 ≠ Scarlet & Violet bas — extraordet ÄR setidentiteten,",
  "   - olika Pokémon/variant (Palkia ≠ Arceus, Zapdos 3-pack ≠ Pikachu 3-pack, Vaporeon ≠ Meowth),",
  "   - olika produkttyp (booster pack ≠ box ≠ ETB ≠ tin ≠ blister ≠ collection; sampling pack ≠ booster pack),",
  "   - olika OFFICIELLA produktnamn för samma Pokémon: 'Special Collection' ≠ 'EX Box' ≠ 'Premium Collection'",
  "     ≠ 'ex Box' — olika namngivna produkter är olika produkter även med samma Pokémon på asken,",
  "   - 'Pokémon Center'-exklusiv variant (t.ex. Pokémon Center ETB) ≠ vanlig variant utan 'Pokémon Center',",
  "   - olika antal (half booster box/18 paket ≠ hel box/36; enkelpack ≠ 3-pack),",
  "   - japansk produkt ≠ engelsk produkt, samt 'Ultra-Premium' ≠ 'Premium'.",
  "   Följande är INTE skillnader (= samma produkt): serie-/era-namn som prefix (Scarlet & Violet, Sword & Shield,",
  "   Sun & Moon, Mega Evolution, XY m.fl. — det är setets familj, ingen variant); 'Display'/'Display Box' =",
  "   'Booster Box' (båda = 36 paket = hel box); att annonsen är skriven på svenska; annan ordföljd/stavning.",
  "   Osäker UTAN konkret motsägelse: sätt sameProduct = true (dölj inte en trolig äkta annons).",
  "2. sealedComplete — är det fortfarande den KOMPLETTA, fabriksförseglade (oöppnade) produkten?",
  "   false BARA om den är öppnad, tom ('tom ask'), endast asken, av-/omförseglad, saknar innehåll,",
  "   är en kopia/proxy, eller på annat sätt inte längre den förseglade produkten.",
  "   Mindre KOSMETISKA skavanker på en fortfarande FÖRSEGLAD vara (buckla, veck, repa, solblekning,",
  "   litet tryckmärke, 'skick som på bilderna'-friskrivning) gör den INTE ofullständig → sealedComplete = true.",
  "Ge en KORT motivering på svenska. Anropa alltid report_verification.",
].join(" ");

const VERIFY_TOOL: Anthropic.Tool = {
  name: "report_verification",
  description: "Rapportera verifieringen av Tradera-annonsen mot katalogprodukten.",
  input_schema: {
    type: "object",
    properties: {
      sameProduct: { type: "boolean", description: "Exakt samma produkt/variant?" },
      sealedComplete: { type: "boolean", description: "Komplett, oöppnad, oskadad?" },
      reason: { type: "string", description: "Kort motivering på svenska." },
    },
    required: ["sameProduct", "sealedComplete", "reason"],
  },
};

export async function verifyMatch(
  client: Anthropic,
  product: { title: string; category: string; refKr?: number },
  listing: { title: string; description: string }
): Promise<{ sameProduct: boolean; sealedComplete: boolean; reason: string }> {
  const priceLine = product.refKr ? `Ungefärligt marknadspris: ${product.refKr} kr\n` : "";
  const response = await client.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 512,
    system: SYSTEM,
    tools: [VERIFY_TOOL],
    tool_choice: { type: "tool", name: "report_verification" },
    messages: [
      {
        role: "user",
        content:
          `KATALOGPRODUKT:\nTitel: ${product.title}\nKategori: ${product.category}\n${priceLine}\n` +
          `TRADERA-ANNONS:\nTitel: ${listing.title}\nBeskrivning: ${listing.description || "(ingen beskrivning)"}\n\n` +
          `Är annonsen exakt samma produkt, och är den komplett/oöppnad/oskadad? Anropa report_verification.`,
      },
    ],
  });
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  const input = (toolUse?.input ?? {}) as Record<string, unknown>;
  return {
    sameProduct: input.sameProduct === true,
    sealedComplete: input.sealedComplete === true,
    reason: typeof input.reason === "string" ? input.reason.slice(0, 200) : "",
  };
}

export interface VerifyDealsResult {
  candidates: number;
  verified: number;
  ok: number;
  rejected: number;
  skipped: number;
}

/**
 * Verifierar alla fynd-kandidater som saknar färsk DealCheck (eller vars pris ändrats).
 * Sätter DealCheck.ok som fynd-feeden sedan filtrerar på.
 */
export async function verifyDeals(
  log: (msg: string) => void = console.log
): Promise<VerifyDealsResult> {
  const res: VerifyDealsResult = { candidates: 0, verified: 0, ok: 0, rejected: 0, skipped: 0 };
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!appId || !appKey || !anthropicKey) {
    log("[verify-deals] saknar TRADERA_APP_ID/KEY eller ANTHROPIC_API_KEY — hoppar över.");
    return res;
  }
  const client = new Anthropic({ apiKey: anthropicKey });

  const candidates = await dealCandidateOffers();
  res.candidates = candidates.length;
  log(`[verify-deals] ${candidates.length} kandidater (rabatt ${Math.round(DEAL_MIN_DISCOUNT * 100)}–${Math.round(DEAL_MAX_DISCOUNT * 100)} %).`);

  // Redan färskt verifierade (samma pris, senaste dygnet) hoppas över.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = new Map(
    (
      await prisma.dealCheck.findMany({
        where: { offerId: { in: candidates.map((c) => c.offerId) } },
        select: { offerId: true, checkedPrice: true, checkedAt: true },
      })
    ).map((d) => [d.offerId, d])
  );

  await mapPool(candidates, 3, async (c) => {
    const prev = existing.get(c.offerId);
    if (prev && prev.checkedPrice === c.traderaPrice && prev.checkedAt >= dayAgo) {
      res.skipped++;
      return;
    }
    const itemId = extractTraderaItemId(c.traderaUrl);
    if (!itemId) {
      res.skipped++;
      return;
    }
    const item = await fetchTraderaItem(itemId, appId, appKey);
    if (!item) {
      res.skipped++;
      return;
    }

    let sameProduct = false;
    let sealedComplete = false;
    let reason = "";
    // Utgången/tom vara: hoppa över LLM-anropet helt.
    if (!item.ended && item.remaining > 0) {
      const v = await verifyMatch(
        client,
        { title: c.title, category: c.category, refKr: Math.round(c.cmPrice / 100) },
        { title: item.title, description: item.description }
      );
      sameProduct = v.sameProduct;
      sealedComplete = v.sealedComplete;
      reason = v.reason;
    } else {
      reason = "Annonsen avslutad";
    }

    const ok = dealVerdict({ sameProduct, sealedComplete, ended: item.ended, remaining: item.remaining });
    await prisma.dealCheck.upsert({
      where: { offerId: c.offerId },
      create: {
        offerId: c.offerId,
        ok,
        checkedPrice: c.traderaPrice,
        listingTitle: item.title || c.title,
        reason,
        endsAt: item.endsAt,
      },
      update: {
        ok,
        checkedPrice: c.traderaPrice,
        listingTitle: item.title || c.title,
        reason,
        endsAt: item.endsAt,
        checkedAt: new Date(),
      },
    });
    res.verified++;
    if (ok) res.ok++;
    else res.rejected++;
  });

  log(`[verify-deals] verifierade ${res.verified} (ok ${res.ok}, avvisade ${res.rejected}), hoppade ${res.skipped}.`);
  return res;
}

export interface VerifyMatchesResult {
  offers: number;
  checked: number;
  ok: number;
  wrong: number;
  hidden: number;
  restored: number;
  skipped: number;
}

/** Tradera-itemId för en offer: ur URL:en, annars ur senaste sweep-observationens rawData. */
async function resolveItemId(offer: { url: string; productId: string }): Promise<string | null> {
  const fromUrl = extractTraderaItemId(offer.url);
  if (fromUrl) return fromUrl;
  // Nollställda offers har sök-URL (ingen itemId) → ta itemId från sweepens observation.
  const obs = await prisma.priceObservation.findFirst({
    where: { productId: offer.productId, rawData: { path: ["source"], equals: "tradera-sweep" } },
    orderBy: { observedAt: "desc" },
    select: { rawData: true },
  });
  const id = obs?.rawData && typeof obs.rawData === "object" ? (obs.rawData as Record<string, unknown>).itemId : null;
  return typeof id === "string" ? id : null;
}

/**
 * GLOBAL Tradera-matchningsverifiering (ALLA sealed-offers, inte bara fynd). Bigram-
 * matchningen felmatchar mall-namngivna sealed-produkter ("Palkia VSTAR Premium" mot
 * "Arceus VSTAR Premium"), japanska mot engelska, öppnade/tomma varor m.m. Varje annons
 * LLM-koll (samma produkt + komplett/oöppnad/aktiv). SJÄLVLÄKANDE:
 *  - fel/skräp → nollställ offer (pris null + sök-URL → isDirectOfferUrl döljer överallt),
 *  - ok men dold → ÅTERSTÄLL (pris + direktlänk från GetItem) om en tidigare dom var för hård.
 * Domen cachas i TraderaMatch (annons+produkt, stabilt) så sweepen aldrig återskapar en känd
 * felmatch. Kör om en (annons, produkt) tas bort ur TraderaMatch → omprövas med aktuell prompt.
 */
export async function verifyTraderaMatches(
  log: (msg: string) => void = console.log
): Promise<VerifyMatchesResult> {
  const res: VerifyMatchesResult = { offers: 0, checked: 0, ok: 0, wrong: 0, hidden: 0, restored: 0, skipped: 0 };
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!appId || !appKey || !anthropicKey) {
    log("[verify-matches] saknar TRADERA_APP_ID/KEY eller ANTHROPIC_API_KEY — hoppar över.");
    return res;
  }
  const tradera = await prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } });
  if (!tradera) return res;
  const client = new Anthropic({ apiKey: anthropicKey });

  // ALLA sealed Tradera-offers (inkl. nollställda/dolda, så en för hård dom kan läkas).
  const offers = await prisma.offer.findMany({
    where: {
      retailerId: tradera.id,
      product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"] } },
    },
    select: {
      id: true,
      productId: true,
      url: true,
      price: true,
      product: {
        select: { title: true, category: true, card: { select: { name: true, set: { select: { name: true } } } } },
      },
    },
  });
  res.offers = offers.length;
  log(`[verify-matches] ${offers.length} sealed Tradera-offers.`);

  // Redan avgjorda (annons, produkt)-par hoppas över — domen är stabil.
  const known = new Set(
    (await prisma.traderaMatch.findMany({ select: { itemId: true, productId: true } })).map(
      (m) => `${m.itemId}|${m.productId}`
    )
  );

  await mapPool(offers, 3, async (offer) => {
    const itemId = await resolveItemId(offer);
    if (!itemId || known.has(`${itemId}|${offer.productId}`)) {
      res.skipped++;
      return;
    }
    const item = await fetchTraderaItem(itemId, appId, appKey);
    if (!item) {
      res.skipped++;
      return;
    }
    res.checked++;

    let ok: boolean;
    let reason: string;
    if (item.ended || item.remaining < 1) {
      ok = false;
      reason = "Annonsen avslutad";
    } else {
      const v = await verifyMatch(
        client,
        { title: offer.product.title, category: offer.product.category },
        { title: item.title, description: item.description }
      );
      ok = dealVerdict({ sameProduct: v.sameProduct, sealedComplete: v.sealedComplete, ended: item.ended, remaining: item.remaining });
      reason = v.reason;
    }

    await prisma.traderaMatch.upsert({
      where: { itemId_productId: { itemId, productId: offer.productId } },
      create: { itemId, productId: offer.productId, ok, reason },
      update: { ok, reason, checkedAt: new Date() },
    });

    if (!ok) {
      res.wrong++;
      // Dölj felmatchen/skräpet överallt: pris null + sök-URL (ej direktlänk → isDirectOfferUrl false).
      await prisma.offer.update({
        where: { id: offer.id },
        data: { price: null, stockStatus: StockStatus.UNKNOWN, url: traderaResetSearchUrl(offer.product) },
      });
      res.hidden++;
      log(`   ❌ dolde: ${offer.product.title} ← "${item.title.slice(0, 45)}" (${reason.slice(0, 50)})`);
    } else {
      res.ok++;
      // Var offern dold av en tidigare (för hård) dom? Återställ pris + direktlänk från GetItem.
      if (offer.price == null && item.priceOre && item.url) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: { price: item.priceOre, stockStatus: StockStatus.IN_STOCK, url: item.url, lastSeenAt: new Date() },
        });
        res.restored++;
        log(`   ♻️  återställde: ${offer.product.title} ← "${item.title.slice(0, 45)}"`);
      }
    }
  });

  log(`[verify-matches] kollade ${res.checked} (ok ${res.ok}, fel ${res.wrong} → dolda ${res.hidden}, återställda ${res.restored}), hoppade ${res.skipped}.`);
  return res;
}
