/**
 * TRADERA SÅLT — vad folk faktiskt BETALADE, som en egen kurva.
 *
 * ⛔ **BARA AUKTIONER MED BUD.** En avslutad `PureBuyItNow` har `HasBids=false` och
 * `BuyItNowPrice == MaxBid` oavsett om någon köpte den eller om den bara löpte ut —
 * de två tillstånden är IDENTISKA i API-svaret (mätt 2026-08-06: 2 109 av 2 768
 * avslutade utan bud bar exakt den likheten). En avslutad AUKTION med bud bär
 * däremot vinnande budet i `MaxBid`, i kronor, och det ÄR en genomförd affär.
 * Att tolka de övriga vore fabricerad data.
 *
 * ⛔ **EGEN SERIE, ALDRIG ERSÄTTARE** (ägarbeslut 2026-08-06, mätt före bygget).
 * Hammarpris är vad någon BETALADE; Cardmarket-serien är vad någon BEGÄR. De får
 * inte bo i samma kurva — samma fel som skarven trend/golv, fast mellan två
 * kurvor. Och volymen tillåter det inte heller: annonskurvan täcker 19 561
 * produkter på 30 dygn, sålt några hundra (nästan bara hett sealed). Ett byte
 * hade tömt Tradera-kurvan för ~9 av 10 produkter som har en.
 *
 * ⛔ **SKRIVER ALDRIG EN `Offer`.** En såld annons går inte att köpa. Länken och
 * karusellen ("Fler annonser på Tradera") lever kvar på tradera-sweep, som svepar
 * AKTIVA BuyItNow-annonser. Det här jobbet rör bara `PriceObservation`.
 *
 * ⛔ **IDEMPOTENT PÅ `itemId`.** Ended-sökningen når ~39 dygn bak, så en daglig
 * körning ser samma försäljning om och om igen. Utan dedup hade dagens median
 * (se `bucketObservationsBySource`) vägt in samma affär en gång per körning.
 */
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { normalizeTitle } from "../lib/utils";
import { isBlockedListingLanguage } from "../lib/listing-language";
import { matchProduct, getListingPriceGuard } from "../scrapers/matching";
import { traderaCategoryCompatible } from "./tradera-sweep";
import { TRADERA_SOLD_SOURCE_NAME } from "../services/products";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";

/** Samma fyra Pokémon-kategorier som det aktiva svepet. */
const CATEGORIES = [1001337, 1001340, 1001339, 1001341] as const;

/**
 * Hur långt bak vi bryr oss. Ended-sökningen når ~39 dygn (mätt), och fönstret
 * styr BÅDE vilka affärer som accepteras och hur långt dedup-uppslaget läser.
 * ⛔ De två MÅSTE vara samma tal: läser dedupen kortare än vi accepterar skrivs
 * gamla affärer in på nytt vid varje körning.
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

export interface SoldItem {
  itemId: string;
  title: string;
  /** Vinnande bud i öre. */
  priceOre: number;
  url: string;
  endDate: Date;
  categoryId?: number;
  bidCount: number | null;
}

/**
 * Avslutade annonser → BARA de som bevisligen såldes.
 *
 * Villkoren är avsiktligt hårda och var för sig nödvändiga:
 * `IsEnded` (annonsen är slut), `HasBids` (någon bjöd), en auktionstyp (en
 * ShopItem/PureBuyItNow kan inte bevisas såld) och ett positivt `MaxBid`.
 */
export function parseSoldFromXml(xml: string): { items: SoldItem[]; totalPages: number } {
  const pagesText = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
  const totalPages = pagesText ? parseInt(pagesText[1], 10) : 1;
  const blocks = [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
  const items: SoldItem[] = [];

  for (const block of blocks) {
    const itemId = tagText(block, "Id");
    const title = tagText(block, "ShortDescription");
    if (!itemId || !title) continue;

    if (tagText(block, "IsEnded") !== "true") continue;
    if (tagText(block, "HasBids") !== "true") continue;
    // "Auction" och "AuctionWithBuyItNow" är budbara. PureBuyItNow/ShopItem är det
    // inte, och en HasBids=true där vore ett svar vi inte förstår → hoppa hellre.
    const itemType = tagText(block, "ItemType") ?? "";
    if (!itemType.startsWith("Auction")) continue;

    const bidText = tagText(block, "MaxBid");
    const bid = bidText ? parseFloat(bidText.replace(",", ".")) : NaN;
    if (!Number.isFinite(bid) || bid <= 0) continue;

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
      priceOre: Math.round(bid * 100),
      url,
      endDate,
      categoryId: catText ? parseInt(catText, 10) : undefined,
      bidCount: bidsText ? parseInt(bidsText, 10) : null,
    });
  }

  return { items, totalPages };
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchEndedPage(
  appId: string,
  appKey: string,
  catId: number,
  page: number
): Promise<string> {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords>pokemon</SearchWords><CategoryId>${catId}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${page}</PageNumber><OrderBy>EndDateDescending</OrderBy><ItemStatus>Ended</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
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
  /** Sidor per kategori (50 träffar/sida). 10 × 4 kategorier = 40 API-anrop. */
  pages?: number;
  log?: (msg: string) => void;
}

export interface TraderaSoldSweepResult {
  apiCalls: number;
  endedFetched: number;
  verifiedSales: number;
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
  const pages = opts.pages ?? parseInt(process.env.TRADERA_SOLD_PAGES ?? "10", 10);
  const log = opts.log ?? ((m: string) => console.log(m));

  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error("TRADERA_APP_ID/TRADERA_APP_KEY saknas i miljön");
  }

  const cutoff = new Date(Date.now() - SOLD_WINDOW_DAYS * 86_400_000);

  // ── Hämta ──────────────────────────────────────────────────────────────────
  log(`📡 Hämtar avslutade annonser (${pages} sidor × ${CATEGORIES.length} kategorier)...`);
  const sales = new Map<string, SoldItem>();
  let apiCalls = 0;
  let endedFetched = 0;

  for (const catId of CATEGORIES) {
    for (let page = 1; page <= pages; page++) {
      let parsed;
      try {
        const xml = await fetchEndedPage(appId, appKey, catId, page);
        apiCalls++;
        parsed = parseSoldFromXml(xml);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`   ⚠️ kategori ${catId} sida ${page}: ${msg}`);
        // Kvot slut → sluta helt, annars bara nästa kategori.
        if (msg.includes("429") || msg.includes("AboveCallLimit")) {
          log("   ⛔ Traderas kvot slut — avbryter hämtningen.");
          page = pages;
          break;
        }
        break;
      }
      endedFetched += parsed.items.length;
      for (const item of parsed.items) {
        if (item.endDate < cutoff) continue;
        if (!sales.has(item.itemId)) sales.set(item.itemId, item);
      }
      if (parsed.items.length === 0 || page >= parsed.totalPages) break;
    }
  }
  log(`   ${apiCalls} anrop → ${sales.size} verifierade försäljningar inom ${SOLD_WINDOW_DAYS} dygn`);

  const sourceId = await traderaSoldSourceId();

  // ── Redan bokförda (idempotens) ────────────────────────────────────────────
  // ⛔ Samma fönster som urvalet ovan. Läser dedupen kortare än vi accepterar
  // skrivs gamla affärer in på nytt vid varje körning och dagens median blir fel.
  const known = new Set(
    (
      await prisma.$queryRaw<{ itemId: string | null }[]>`
        SELECT "rawData"->>'itemId' AS "itemId"
        FROM "PriceObservation"
        WHERE "sourceId" = ${sourceId} AND "observedAt" >= ${cutoff}
      `
    )
      .map((r) => r.itemId)
      .filter((v): v is string => !!v)
  );

  const fresh = [...sales.values()].filter((s) => !known.has(s.itemId));
  const alreadyKnown = sales.size - fresh.length;
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

  // ── Matcha + skriv ─────────────────────────────────────────────────────────
  let noMatch = 0;
  let categoryMismatch = 0;
  let implausible = 0;
  let written = 0;
  const touched = new Set<string>();
  // Prisvakten hämtar facit per produkt — cacha den, flera affärer delar produkt.
  const guards = new Map<string, (priceOre: number) => boolean>();

  await mapPool(fresh, DB_CONCURRENCY, async (sale) => {
    const match = await matchProduct(normalizeTitle(sale.title));
    if (!match) {
      noMatch++;
      return;
    }
    if (rejected.has(`${sale.itemId}|${match.productId}`)) {
      noMatch++;
      return;
    }
    const product = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { id: true, category: true },
    });
    if (!product) {
      noMatch++;
      return;
    }
    if (!traderaCategoryCompatible(product.category, sale.categoryId)) {
      categoryMismatch++;
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
    if (!guard(sale.priceOre)) {
      implausible++;
      return;
    }

    touched.add(product.id);
    if (dryRun) return;

    const condition =
      product.category === "SINGLE_CARD" || product.category === "GRADED_CARD"
        ? "NEAR_MINT"
        : "SEALED";

    await prisma.priceObservation.create({
      data: {
        productId: product.id,
        sourceId,
        price: sale.priceOre,
        currency: "SEK",
        condition,
        // ⛔ Affärens EGEN sluttid, inte körningens. Annars hade 39 dygn gamla
        // försäljningar klumpat ihop sig på den dag vi råkade hämta dem.
        observedAt: sale.endDate,
        rawData: {
          itemId: sale.itemId,
          title: sale.title,
          priceOre: sale.priceOre,
          url: sale.url,
          bidCount: sale.bidCount,
          endDate: sale.endDate.toISOString(),
          source: "tradera-sold-sweep",
        },
      },
    });
    written++;
  });

  log(
    `\n🎉 Klart! ${written} sålda priser skrivna på ${touched.size} produkter` +
      `${dryRun ? " (DRY_RUN — inget skrevs)" : ""}`
  );
  log(`   Ej matchade: ${noMatch} | Kategorifel: ${categoryMismatch} | Orimligt pris: ${implausible}`);

  return {
    apiCalls,
    endedFetched,
    verifiedSales: sales.size,
    alreadyKnown,
    noMatch,
    categoryMismatch,
    implausible,
    written,
    products: touched.size,
  };
}
