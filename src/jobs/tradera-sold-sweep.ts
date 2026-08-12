/**
 * TRADERA SÅLT — vad folk faktiskt BETALADE, som en egen kurva.
 *
 * TVÅ BEVISVÄGAR (2026-08-12 — utökningen är MÄTT, inte gissad):
 *
 *  1. **AUKTION MED BUD** (som förut): en avslutad auktion med `HasBids=true` bär
 *     vinnande budet i `MaxBid`. Det ÄR en genomförd affär, direkt ur sök-svaret.
 *
 *  2. **GetItem-VERIFIERAD KÖP NU/BUTIKSANNONS** (ny): i SÖK-svaret är en såld och en
 *     utgången `PureBuyItNow` identiska (`HasBids=false`, `BuyItNowPrice == MaxBid` —
 *     mätt 2026-08-06: 2 109 av 2 768). Men `PublicService.GetItem` skiljer dem:
 *     en såld annons svarar `GotWinner=true` + `RemainingQuantity=0`, en utgången
 *     `GotWinner=false` (verifierat 2026-08-12 mot annonser som Traderas egen
 *     "Sålda"-filtrering listar). Priset: `TotalBids>0` ⇒ `MaxBid` (accepterat bud på
 *     en Köp nu-annons kan ligga UNDER utropet — mätt: BIN 250, betalt 198), annars
 *     `BuyItNowPrice`. GetItem kostar ett anrop per annons och görs därför EFTER
 *     matchning + vakter — kvoten går bara till annonser som kan bli en grafpunkt.
 *
 * ⛔ **SÖKORDET ÄR BORTA MED FLIT** (2026-08-12): kategorierna ÄR Pokémon-kategorier,
 * och `SearchWords=pokemon` gömde varje annons utan ordet i titeln — "Mega Darkrai ex
 * 120/084" syntes aldrig. Mätt i singel-kategorin: 118 543 avslutade med ordet,
 * 346 023 utan filter — vi såg alltså bara en tredjedel.
 *
 * ⛔ **DJUPET STYRS AV TID, INTE AV ETT SIDANTAL**: singel-kategorin ensam avslutar
 * ~8 900 annonser/dygn (≈178 sidor) medan boxar avslutar ~150. Pagineringen läser
 * tills sidans äldsta slutdatum passerat `TRADERA_SOLD_LOOKBACK_DAYS` (default 3 —
 * dygnstakt + marginal för missade körningar). ⚠️ API:t SERVERAR bara ~200 sidor per
 * fråga hur stort `TotalNumberOfItems` än är (sida 300 svarar tomt, mätt 2026-08-12),
 * så äldre svans nås bara via t.ex. prisband — inte värt det för en daglig körning.
 *
 * ⛔ **EGEN SERIE, ALDRIG ERSÄTTARE** (ägarbeslut 2026-08-06, mätt före bygget).
 * Hammarpris är vad någon BETALADE; Cardmarket-serien är vad någon BEGÄR. De får
 * inte bo i samma kurva — samma fel som skarven trend/golv, fast mellan två kurvor.
 *
 * ⛔ **SKRIVER ALDRIG EN `Offer`.** En såld annons går inte att köpa. Länken och
 * karusellen ("Fler annonser på Tradera") lever kvar på tradera-sweep, som svepar
 * AKTIVA annonser. Det här jobbet rör bara `PriceObservation`.
 *
 * ⛔ **IDEMPOTENT PÅ `itemId`.** En daglig körning ser samma försäljning om och om
 * igen (lookback > körtakt). Utan dedup hade dagens median vägt in samma affär en
 * gång per körning. Dedup-fönstret (SOLD_WINDOW_DAYS) är ett TAK över lookbacken.
 */
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { normalizeTitle } from "../lib/utils";
import { isBlockedListingLanguage } from "../lib/listing-language";
import { matchProduct, getListingPriceGuard } from "../scrapers/matching";
import { traderaCategoryCompatible } from "./tradera-sweep";
import { TRADERA_SOLD_SOURCE_NAME } from "../services/products";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";

/** Samma fyra Pokémon-kategorier som det aktiva svepet. */
const CATEGORIES = [1001337, 1001340, 1001339, 1001341] as const;

/**
 * Absolut acceptans- OCH dedup-fönster. ⛔ De två MÅSTE vara samma tal: läser
 * dedupen kortare än vi accepterar skrivs gamla affärer in på nytt vid varje körning.
 */
export const SOLD_WINDOW_DAYS = 45;

const DB_CONCURRENCY = 8;

// ─── XML ─────────────────────────────────────────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  if (!m) return undefined;
  const v = decodeEntities(m[1].trim());
  return v.length > 0 ? v : undefined;
}

function kronorToOre(text: string | undefined): number | null {
  if (!text) return null;
  const n = parseFloat(text.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** En AVSLUTAD annons ur sök-svaret — såld eller inte vet vi först efter bevisvägen. */
export interface EndedItem {
  itemId: string;
  title: string;
  itemType: string;
  hasBids: boolean;
  /** Högsta bud i öre (för Köp nu-annonser speglar fältet utropet när bud saknas). */
  maxBidOre: number | null;
  buyItNowOre: number | null;
  url: string;
  endDate: Date;
  categoryId?: number;
  bidCount: number | null;
}

/**
 * Avslutade annonser ur ett sök-svar — ALLA, inte bara de budbevisade. Vilken
 * bevisväg en annons behöver avgörs av `soldByBidsOre` respektive GetItem-steget.
 *
 * `rawRows` = antal <Items>-block FÖRE filtrering. ⛔ Pagineringen får bara bryta på
 * rawRows === 0: en sida kan sakna godkända rader (språkspärr, trasiga datum) och
 * ändå ha fler sidor efter sig — att bryta på den FILTRERADE längden kapade svepet.
 */
export function parseEndedFromXml(xml: string): {
  items: EndedItem[];
  totalPages: number;
  rawRows: number;
} {
  const pagesText = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
  const totalPages = pagesText ? parseInt(pagesText[1], 10) : 1;
  const blocks = [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
  const items: EndedItem[] = [];

  for (const block of blocks) {
    const itemId = tagText(block, "Id");
    const title = tagText(block, "ShortDescription");
    if (!itemId || !title) continue;
    if (tagText(block, "IsEnded") !== "true") continue;

    const endText = tagText(block, "EndDate");
    const endDate = endText ? new Date(endText) : null;
    if (!endDate || Number.isNaN(endDate.getTime())) continue;

    const rawUrl = tagText(block, "ItemUrl") ?? tagText(block, "ItemLink");
    const url =
      rawUrl && /tradera\.com\/item\//.test(rawUrl)
        ? rawUrl.replace(/^http:\/\//, "https://")
        : `https://www.tradera.com/item/0/${itemId}/`;

    // Samma språkvakt som det aktiva svepet: katalogen är EN + JP only, och
    // Traderas eget språkattribut är tomt hos de flesta privatsäljare.
    if (isBlockedListingLanguage(title, url)) continue;

    const catText = tagText(block, "CategoryId");
    const bidsText = tagText(block, "BidCount");

    items.push({
      itemId,
      title,
      itemType: tagText(block, "ItemType") ?? "",
      hasBids: tagText(block, "HasBids") === "true",
      maxBidOre: kronorToOre(tagText(block, "MaxBid")),
      buyItNowOre: kronorToOre(tagText(block, "BuyItNowPrice")),
      url,
      endDate,
      categoryId: catText ? parseInt(catText, 10) : undefined,
      bidCount: bidsText ? parseInt(bidsText, 10) : null,
    });
  }

  return { items, totalPages, rawRows: blocks.length };
}

/**
 * Bevisväg 1: budbevisad affär direkt ur sök-svaret. Villkoren är var för sig
 * nödvändiga: en auktionstyp (en PureBuyItNow/ShopItem kan inte budas), någon bjöd,
 * och ett positivt vinnande bud. Allt annat behöver GetItem-vägen.
 */
export function soldByBidsOre(item: Pick<EndedItem, "itemType" | "hasBids" | "maxBidOre">): number | null {
  if (!item.itemType.startsWith("Auction")) return null;
  if (!item.hasBids) return null;
  return item.maxBidOre;
}

/**
 * Bevisväg 2: dom över ett GetItem-svar. `GotWinner=true` är Traderas eget besked
 * att annonsen fick en köpare — exakt det sök-svaret inte kan säga om en Köp nu.
 * Priset: ett accepterat bud (`TotalBids>0` ⇒ `MaxBid`) kan ligga under utropet,
 * annars gäller Köp nu-priset.
 */
export function getItemVerdict(xml: string): { sold: boolean; priceOre: number | null } {
  if (tagText(xml, "Ended") !== "true") return { sold: false, priceOre: null };
  if (tagText(xml, "GotWinner") !== "true") return { sold: false, priceOre: null };
  const totalBids = parseInt(tagText(xml, "TotalBids") ?? "0", 10);
  const maxBid = kronorToOre(tagText(xml, "MaxBid"));
  const bin = kronorToOre(tagText(xml, "BuyItNowPrice"));
  const priceOre = totalBids > 0 && maxBid ? maxBid : bin;
  return { sold: true, priceOre: priceOre ?? null };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * ⛔ TOMMA SearchWords med flit — kategorin är redan Pokémon-scopad, och varje ord
 * hade gömt annonser (se filhuvudet). Verifierat att API:t accepterar tomt fält.
 */
async function fetchEndedPage(
  appId: string,
  appKey: string,
  catId: number,
  page: number
): Promise<string> {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords></SearchWords><CategoryId>${catId}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${page}</PageNumber><OrderBy>EndDateDescending</OrderBy><ItemStatus>Ended</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"http://api.tradera.com/SearchAdvanced"`,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.text();
}

async function fetchGetItem(appId: string, appKey: string, itemId: string): Promise<string> {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com"><soap:Header><trad:AuthenticationHeader><trad:AppId>${appId}</trad:AppId><trad:AppKey>${appKey}</trad:AppKey></trad:AuthenticationHeader><trad:ConfigurationHeader><trad:Sandbox>0</trad:Sandbox><trad:MaxResultAge>0</trad:MaxResultAge></trad:ConfigurationHeader></soap:Header><soap:Body><trad:GetItem><trad:itemId>${itemId}</trad:itemId></trad:GetItem></soap:Body></soap:Envelope>`;
  const res = await fetch(`${PUBLIC_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"http://api.tradera.com/GetItem"`,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.text();
}

/** ScrapeSource-raden för sålt, skapad vid behov. Memoiserad per process. */
let sourceIdPromise: Promise<string> | null = null;
export function traderaSoldSourceId(): Promise<string> {
  sourceIdPromise ??= prisma.scrapeSource
    .upsert({
      where: { name: TRADERA_SOLD_SOURCE_NAME },
      update: {},
      create: {
        name: TRADERA_SOLD_SOURCE_NAME,
        baseUrl: "https://www.tradera.com",
        // Ingen HTML-skrapa: jobbet pratar med Traderas API. Raden finns bara för
        // att `PriceObservation.sourceId` ska kunna peka på en namngiven källa —
        // och den MÅSTE vara skild från "Tradera", annars hamnar sålt i
        // annonskurvan (se bucketObservationsBySource).
        isActive: false,
      },
      select: { id: true },
    })
    .then((s) => s.id);
  return sourceIdPromise;
}

// ─── Jobbet ──────────────────────────────────────────────────────────────────

export interface TraderaSoldSweepOptions {
  dryRun?: boolean;
  /** Tak för sidor per kategori (50 träffar/sida). Tidsstoppet biter oftast först. */
  pages?: number;
  /** Hur många dygn bak pagineringen läser. Default 3 (dygnstakt + marginal). */
  lookbackDays?: number;
  log?: (msg: string) => void;
}

export interface TraderaSoldSweepResult {
  apiCalls: number;
  endedFetched: number;
  bidsSold: number;
  getItemCalls: number;
  getItemSold: number;
  getItemNotSold: number;
  getItemSkipped: number;
  alreadyKnown: number;
  noMatch: number;
  categoryMismatch: number;
  implausible: number;
  written: number;
  products: number;
}

export async function runTraderaSoldSweep(
  opts: TraderaSoldSweepOptions = {}
): Promise<TraderaSoldSweepResult> {
  const dryRun = opts.dryRun ?? false;
  const pages = opts.pages ?? parseInt(process.env.TRADERA_SOLD_PAGES ?? "200", 10);
  const lookbackDays =
    opts.lookbackDays ?? parseFloat(process.env.TRADERA_SOLD_LOOKBACK_DAYS ?? "3");
  const getItemMax = parseInt(process.env.TRADERA_SOLD_GETITEM_MAX ?? "2500", 10);
  const log = opts.log ?? ((m: string) => console.log(m));

  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error("TRADERA_APP_ID/TRADERA_APP_KEY saknas i miljön");
  }

  const windowCutoff = new Date(Date.now() - SOLD_WINDOW_DAYS * 86_400_000);
  const lookbackCutoff = new Date(
    Date.now() - Math.min(lookbackDays, SOLD_WINDOW_DAYS) * 86_400_000
  );

  // ── Hämta ──────────────────────────────────────────────────────────────────
  log(
    `📡 Hämtar avslutade annonser (${lookbackDays} dygn bak, max ${pages} sidor × ` +
      `${CATEGORIES.length} kategorier)...`
  );
  const ended = new Map<string, EndedItem>();
  let apiCalls = 0;
  let quotaHit = false;

  for (const catId of CATEGORIES) {
    for (let page = 1; page <= pages; page++) {
      let parsed;
      try {
        const xml = await fetchEndedPage(appId, appKey, catId, page);
        apiCalls++;
        parsed = parseEndedFromXml(xml);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`   ⚠️ kategori ${catId} sida ${page}: ${msg}`);
        // Kvot slut → sluta helt, annars bara nästa kategori.
        if (msg.includes("429") || msg.includes("AboveCallLimit")) {
          log("   ⛔ Traderas kvot slut — avbryter hämtningen.");
          quotaHit = true;
        }
        break;
      }
      let oldestOnPage: Date | null = null;
      for (const item of parsed.items) {
        if (!oldestOnPage || item.endDate < oldestOnPage) oldestOnPage = item.endDate;
        if (item.endDate < windowCutoff) continue;
        if (!ended.has(item.itemId)) ended.set(item.itemId, item);
      }
      // Tidsstopp: sidorna är sorterade EndDateDescending, så när sidans äldsta
      // slutdatum passerat lookbacken finns inget nyare kvar längre fram.
      if (oldestOnPage && oldestOnPage < lookbackCutoff) break;
      if (parsed.rawRows === 0 || page >= parsed.totalPages) break;
    }
    if (quotaHit) break;
  }
  log(`   ${apiCalls} sök-anrop → ${ended.size} avslutade annonser inom fönstret`);

  const sourceId = await traderaSoldSourceId();

  // ── Redan bokförda (idempotens) ────────────────────────────────────────────
  // ⛔ Dedup-fönstret är ett TAK över lookbacken (samma konstant som acceptansen).
  const known = new Set(
    (
      await prisma.$queryRaw<{ itemId: string | null }[]>`
        SELECT "rawData"->>'itemId' AS "itemId"
        FROM "PriceObservation"
        WHERE "sourceId" = ${sourceId} AND "observedAt" >= ${windowCutoff}
      `
    )
      .map((r) => r.itemId)
      .filter((v): v is string => !!v)
  );

  const fresh = [...ended.values()].filter((s) => !known.has(s.itemId));
  const alreadyKnown = ended.size - fresh.length;
  log(`   ${alreadyKnown} redan bokförda · ${fresh.length} nya att matcha`);

  // Kända felmatchningar (LLM-dömda) — återskapa aldrig, inte heller som historik.
  const rejected = new Set(
    (
      await prisma.traderaMatch.findMany({
        where: { ok: false },
        select: { itemId: true, productId: true },
      })
    ).map((m) => `${m.itemId}|${m.productId}`)
  );

  // ── Matcha + verifiera + skriv ─────────────────────────────────────────────
  const stats: TraderaSoldSweepResult = {
    apiCalls,
    endedFetched: ended.size,
    bidsSold: 0,
    getItemCalls: 0,
    getItemSold: 0,
    getItemNotSold: 0,
    getItemSkipped: 0,
    alreadyKnown,
    noMatch: 0,
    categoryMismatch: 0,
    implausible: 0,
    written: 0,
    products: 0,
  };
  const touched = new Set<string>();
  // Prisvakten hämtar facit per produkt — cacha den, flera affärer delar produkt.
  const guards = new Map<string, (priceOre: number) => boolean>();
  let getItemQuotaHit = false;

  await mapPool(fresh, DB_CONCURRENCY, async (sale) => {
    const bidsOre = soldByBidsOre(sale);
    // Kandidatpris för vakterna. För en overifierad Köp nu är utropet bästa
    // uppskattningen — det slutliga priset kommer ur GetItem-svaret nedan.
    const candidateOre = bidsOre ?? sale.buyItNowOre ?? sale.maxBidOre;
    if (!candidateOre || candidateOre <= 0) return;

    const match = await matchProduct(normalizeTitle(sale.title));
    if (!match) {
      stats.noMatch++;
      return;
    }
    if (rejected.has(`${sale.itemId}|${match.productId}`)) {
      stats.noMatch++;
      return;
    }
    const product = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { id: true, category: true },
    });
    if (!product) {
      stats.noMatch++;
      return;
    }
    if (!traderaCategoryCompatible(product.category, sale.categoryId)) {
      stats.categoryMismatch++;
      return;
    }
    // Samma rimlighetsvakt som annonserna. Den bevakar lot-/felmatchning, inte
    // "nära begärt pris" — en auktion FÅR gå billigt, och gränserna biter bara på
    // inneboende dyra sealed-kategorier. Mätt behov: "First Partners Illustration
    // Collection Series 2" gav 450–3 000 kr, dvs partiannonser som enstaka vara.
    let guard = guards.get(product.id);
    if (!guard) {
      guard = await getListingPriceGuard(product.id);
      guards.set(product.id, guard);
    }
    if (!guard(candidateOre)) {
      stats.implausible++;
      return;
    }

    let priceOre: number;
    let verify: "bids" | "getitem";
    if (bidsOre) {
      priceOre = bidsOre;
      verify = "bids";
      stats.bidsSold++;
    } else {
      // GetItem SIST i vaktkedjan: kvoten (10k/dygn för metoden) går bara till
      // annonser som redan är matchade, kategorirätta och prisrimliga.
      if (getItemQuotaHit || stats.getItemCalls >= getItemMax) {
        stats.getItemSkipped++;
        return;
      }
      let verdict;
      try {
        stats.getItemCalls++;
        verdict = getItemVerdict(await fetchGetItem(appId, appKey, sale.itemId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.includes("AboveCallLimit")) getItemQuotaHit = true;
        stats.getItemSkipped++;
        return;
      }
      if (!verdict.sold || !verdict.priceOre) {
        stats.getItemNotSold++;
        return;
      }
      // Accepterat bud kan skilja sig från utropet → pröva vakten på FACIT-priset.
      if (!guard(verdict.priceOre)) {
        stats.implausible++;
        return;
      }
      priceOre = verdict.priceOre;
      verify = "getitem";
      stats.getItemSold++;
    }

    touched.add(product.id);
    if (dryRun) {
      stats.written++;
      return;
    }

    const condition =
      product.category === "SINGLE_CARD" || product.category === "GRADED_CARD"
        ? "NEAR_MINT"
        : "SEALED";

    await prisma.priceObservation.create({
      data: {
        productId: product.id,
        sourceId,
        price: priceOre,
        currency: "SEK",
        condition,
        // ⛔ Affärens EGEN sluttid, inte körningens. Annars hade gamla
        // försäljningar klumpat ihop sig på den dag vi råkade hämta dem.
        observedAt: sale.endDate,
        rawData: {
          itemId: sale.itemId,
          title: sale.title,
          priceOre,
          url: sale.url,
          bidCount: sale.bidCount,
          endDate: sale.endDate.toISOString(),
          verify,
          source: "tradera-sold-sweep",
        },
      },
    });
    stats.written++;
  });

  stats.products = touched.size;
  log(
    `\n🎉 Klart! ${stats.written} sålda priser skrivna på ${touched.size} produkter` +
      `${dryRun ? " (DRY_RUN — inget skrevs)" : ""}`
  );
  log(
    `   Budbevisade: ${stats.bidsSold} | GetItem: ${stats.getItemCalls} anrop → ` +
      `${stats.getItemSold} sålda, ${stats.getItemNotSold} osålda, ${stats.getItemSkipped} hoppade`
  );
  log(
    `   Ej matchade: ${stats.noMatch} | Kategorifel: ${stats.categoryMismatch} | ` +
      `Orimligt pris: ${stats.implausible}`
  );

  return stats;
}
