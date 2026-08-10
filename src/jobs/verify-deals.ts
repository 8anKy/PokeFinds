/**
 * Fynd-verifiering (Pro-only "Fynd"-feed).
 *
 * Fynd-feeden lyfter fram Tradera-annonser långt under sitt Cardmarket-pris — men
 * den lyfter DÄRMED fram de sämsta matchningarna (fel produkt = störst "rabatt"),
 * plus tomma/skadade varor och utgångna annonser. Bigram-matchningen kan inte skilja
 * mall-namngivna sealed-produkter åt ("Palkia VSTAR Premium" vs "Arceus VSTAR Premium").
 *
 * Kandidatmängden är LITEN (tiotal) → vi har råd med ett dyrt, exakt anrop per annons:
 * hämta Tradera-annonsens fulla beskrivning (GetItem) och låt en LLM avgöra om det
 * VERKLIGEN är samma sealed produkt OCH att den är komplett/oöppnad/oskadad. Resultatet
 * cachas i DealCheck (per offer + pris) så vi bara omverifierar när priset ändras.
 *
 * LEVERANTÖREN ÄR UTBYTBAR (`DEALS_VERIFY_PROVIDER=claude|gemini`, se
 * `src/services/deal-verify/`). Prompt, fältspec och svarstolkning är DELADE, så
 * ett byte mäter modellen och inget annat. Standard är claude — se index.ts.
 *
 * KOSTNAD PER ANROP — ANTAGANDEN, INTE MÄTNING. Systemprompten är 2 469 tecken
 * (räknat), svensk text ≈ 3 tecken/token → ~820 tokens; + verktygsschema ~90 och
 * annonsen (titel + LongDescription ~600 tecken) ~270 ⇒ ~1 200 in-tokens. Ut är
 * domen, ~50 tokens.
 *   Haiku 4.5 ($1 / $5 per MTok)             → ~$0,0015
 *   Gemini 3.1 Flash-Lite (~$0,30/MTok in¹)  → ~$0,0005   (~3x billigare)
 *   Gemini 2.5 Flash-Lite ($0,10 / $0,40)    → ~$0,00014  (~10x) — MEN 2.5 är
 *     spärrad för nya API-nycklar, se gemini.ts.
 * ¹ härlett ur skannerns EGEN mätning (4 850 in-tokens → $0,00144), inte ur en
 * prislista. ⚠️ Gemini 3 kan inte stänga av tänkandet och TÄNK-TOKENS FAKTURERAS
 * SOM UTDATA — några hundra sådana per anrop äter större delen av marginalen.
 *
 * Volymen är tiotal anrop/dygn (verifyTraderaMatches cachar per par), så hela
 * skillnaden är ~$1–2/MÅNAD. ⛔ Byt alltså inte leverantör för pengarnas skull;
 * skälet måste vara kvalitet — och den ska mätas, inte antas.
 *
 * Kräver TRADERA_APP_ID/TRADERA_APP_KEY + leverantörens nyckel (ANTHROPIC_API_KEY
 * eller GEMINI_API_KEY). Körs sist i tradera-sweepen.
 */
import { prisma } from "@/lib/db";
import { mapPool } from "@/lib/concurrency";
import { dealCandidateOffers, DEAL_MIN_DISCOUNT, DEAL_MAX_DISCOUNT } from "@/services/products";
import { traderaResetSearchUrl } from "@/jobs/tradera-sweep";
import { getDealVerifyAdapter } from "@/services/deal-verify";
import type {
  DealVerification,
  DealVerifyAdapter,
  DealVerifyListing,
  DealVerifyProduct,
} from "@/services/deal-verify/contract";
import { StockStatus } from "@prisma/client";

const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";

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

/**
 * Ett verifieringsanrop. Prompten och tolkningen bor i deal-verify-kontraktet;
 * här ligger BARA felhanteringen.
 *
 * ⛔ FAILAR STÄNGT, OCH "STÄNGT" BETYDER INGEN SKRIVNING ALLS. Ett nätverksfel,
 * en spärrad modell eller ett svar som inte går att tolka är INGEN KUNSKAP — inte
 * ett "nej". Den gamla koden gjorde ett saknat fält till `false`, vilket i
 * verifyTraderaMatches är DESTRUKTIVT (offern nollas och döljs överallt) och i
 * Fynd-feeden cachas som en dom i ett dygn. Nu returneras null och anroparen rör
 * ingenting: annonsen syns inte i Fynd (feeden kräver DealCheck.ok = true),
 * befintliga domar står kvar, och nästa körning prövar igen.
 *
 * ⛔ Undantaget FÅR inte bubbla: mapPool kör N workers med Promise.all, så EN
 * misslyckad annons hade annars fällt hela verifieringen mitt i svepet.
 */
export async function verifyMatch(
  adapter: DealVerifyAdapter,
  product: DealVerifyProduct,
  listing: DealVerifyListing
): Promise<DealVerification | null> {
  try {
    return await adapter.verify(product, listing);
  } catch (err) {
    console.warn(
      `[deal-verify/${adapter.name}] anropet misslyckades:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export interface VerifyDealsResult {
  candidates: number;
  verified: number;
  ok: number;
  rejected: number;
  skipped: number;
  /** Annonser där LLM:en inte gav en tolkbar dom → INGEN DealCheck skrevs. */
  unverified: number;
}

/**
 * Verifierar alla fynd-kandidater som saknar färsk DealCheck (eller vars pris ändrats).
 * Sätter DealCheck.ok som fynd-feeden sedan filtrerar på.
 */
export async function verifyDeals(
  log: (msg: string) => void = console.log
): Promise<VerifyDealsResult> {
  const res: VerifyDealsResult = {
    candidates: 0, verified: 0, ok: 0, rejected: 0, skipped: 0, unverified: 0,
  };
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) {
    log("[verify-deals] saknar TRADERA_APP_ID/KEY — hoppar över.");
    return res;
  }
  const adapter = getDealVerifyAdapter(log);
  if (!adapter) return res;
  log(`[verify-deals] leverantör: ${adapter.name} (${adapter.model}).`);

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
        adapter,
        { title: c.title, category: c.category, refKr: Math.round(c.cmPrice / 100) },
        { title: item.title, description: item.description }
      );
      // Ingen tolkbar dom → skriv INGEN DealCheck. Utan rad är annonsen osynlig
      // i Fynd (feeden joinar på ok = true), så tystnad är det säkra utfallet —
      // och en gammal, giltig dom skrivs inte över av ett misslyckat anrop.
      if (!v) {
        res.unverified++;
        return;
      }
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
  // Egen rad: en modell som slutat svara ser annars ut som en lugn dag med få
  // fynd. Här syns skillnaden mellan "inga fynd" och "ingen dom".
  if (res.unverified > 0) {
    log(`[verify-deals] ⚠️  ${res.unverified} annonser fick INGEN dom (LLM-fel/otolkbart svar) — inget skrivet.`);
  }
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
  /** Annonser där LLM:en inte gav en tolkbar dom → INGEN TraderaMatch skrevs. */
  unverified: number;
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
  const res: VerifyMatchesResult = {
    offers: 0, checked: 0, ok: 0, wrong: 0, hidden: 0, restored: 0, skipped: 0, unverified: 0,
  };
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) {
    log("[verify-matches] saknar TRADERA_APP_ID/KEY — hoppar över.");
    return res;
  }
  const adapter = getDealVerifyAdapter(log);
  if (!adapter) return res;
  const tradera = await prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } });
  if (!tradera) return res;
  log(`[verify-matches] leverantör: ${adapter.name} (${adapter.model}).`);

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

  // Redan avgjorda (annons, produkt)-par prövas inte om — domen är stabil. Men de
  // HOPPAS inte längre blint över: en offer som MOTSÄGER en fälld dom nollas igen.
  const known = new Map(
    (await prisma.traderaMatch.findMany({ select: { itemId: true, productId: true, ok: true } })).map(
      (m) => [`${m.itemId}|${m.productId}`, m.ok] as const
    )
  );

  await mapPool(offers, 3, async (offer) => {
    const itemId = await resolveItemId(offer);
    if (!itemId) {
      res.skipped++;
      return;
    }
    const priorOk = known.get(`${itemId}|${offer.productId}`);
    if (priorOk !== undefined) {
      // SJÄLVLÄKNING (2026-08-10): domen fanns, men offern levde vidare ändå —
      // scrape-alls Tradera-adapter skrev tillbaka den "tomma asken" (738310978,
      // dömd 07-07) varje natt i en månad, och den här funktionen hoppade över
      // paret som "redan avgjort". En fälld dom utan verkställighet är ingen dom:
      // bär offern fortfarande annonsens direktlänk eller ett pris → nolla igen,
      // utan nytt LLM-anrop (verdiktet är redan betalt).
      if (priorOk === false && (extractTraderaItemId(offer.url) === itemId || offer.price != null)) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: { price: null, stockStatus: StockStatus.UNKNOWN, url: traderaResetSearchUrl(offer.product) },
        });
        res.hidden++;
        log(`   ❌ nollade igen (dom fanns redan): ${offer.product.title} ← item ${itemId}`);
      }
      res.skipped++;
      return;
    }
    const item = await fetchTraderaItem(itemId, appId, appKey);
    if (!item) {
      res.skipped++;
      return;
    }
    let ok: boolean;
    let reason: string;
    if (item.ended || item.remaining < 1) {
      ok = false;
      reason = "Annonsen avslutad";
    } else {
      const v = await verifyMatch(
        adapter,
        { title: offer.product.title, category: offer.product.category },
        { title: item.title, description: item.description }
      );
      // ⛔ Ingen tolkbar dom → RÖR INGENTING. Här är "fel" destruktivt (offern
      // nollas + döljs överallt), så ett misslyckat anrop får absolut inte
      // räknas som en fällande dom. Paret hamnar inte i TraderaMatch och prövas
      // igen nästa körning.
      if (!v) {
        res.unverified++;
        return;
      }
      ok = dealVerdict({ sameProduct: v.sameProduct, sealedComplete: v.sealedComplete, ended: item.ended, remaining: item.remaining });
      reason = v.reason;
    }
    res.checked++;

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
  if (res.unverified > 0) {
    log(`[verify-matches] ⚠️  ${res.unverified} annonser fick INGEN dom (LLM-fel/otolkbart svar) — inget skrivet.`);
  }
  return res;
}
