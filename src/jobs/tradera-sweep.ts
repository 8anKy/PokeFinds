/**
 * Daglig Tradera-svepning — kärnlogik (delas av CLI-script + jobb-worker).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Tradera-kvot: 10000 anrop/24h PER metod, Unlimited/min             │
 * │                                                                     │
 * │  Fas 0 (≤budget):  Namn-sök per produkt + DIREKT-match (roterar)    │
 * │  Fas 1 (≤500):     Bred sökning — sökmetoder × sidor (pool)         │
 * │  Fas 2 (≤100):     Top-säljare — GetSellerItems (pool)              │
 * │  Fas 3 (0 anrop):  Expiry — nollställ namn-sökta utan färsk träff   │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Prislogik per produkt (productId:retailerId:condition:language):
 *  - Ny match:        Skapa offer med pris + direktlänk till annonsen
 *  - Billigare match: Uppdatera till lägre pris + ny direktlänk
 *  - Dyrare match:    Behåll befintligt (billigare) pris — uppdatera lastSeenAt
 *  - Ej sedd Xd:      Nollställ pris → sök-URL (annonsen troligen utgången)
 *
 * Eftersom Traderas kvot är 24-timmarsbaserad körs detta EN gång per dygn
 * (separat från scrape-all var 8:e h som annars skulle tömma kvoten direkt).
 */
import { StockStatus } from "@prisma/client";
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { normalizeTitle } from "../lib/utils";
import { isBlockedListingLanguage, listingCardLanguage } from "../lib/listing-language";
import {
  matchProduct,
  matchListingToProduct,
  isPlausibleListingPrice,
  getListingPriceGuard,
} from "../scrapers/matching";
import { traderaSearchUrlSpecific, TRADERA_CATEGORY } from "../lib/marketplace-urls";

// Tradera-kategori → produktform-grupp. Säljaren listar varje annons under EN
// kategori; den signalen är mer pålitlig än titeln (en pack-annons kan heta bara
// "...Journey Together." utan formord och annars matcha en ETB). En annons i en
// känd grupp får bara bli offerten för en produkt i SAMMA grupp.
const TRADERA_CAT_GROUP: Record<number, string> = {
  1001337: "single", // Löskort
  1001339: "pack",   // Boosterpaket (+ blister)
  1001340: "box",    // Boosterboxar
  1001341: "sealed", // Övrigt sealed (ETB, collection, tin, bundle)
};
const PRODUCT_CAT_GROUP: Record<string, string> = {
  SINGLE_CARD: "single", GRADED_CARD: "single",
  BOOSTER_PACK: "pack", BLISTER: "pack",
  BOOSTER_BOX: "box",
  ETB: "sealed", COLLECTION_BOX: "sealed", TIN: "sealed", BUNDLE: "sealed", OTHER: "sealed",
};

/** Produktform som behövs för att bygga en Tradera-sök-URL vid nollställning. */
export type TraderaResetProduct = {
  title: string;
  category: string;
  card: { name: string; set: { name: string } } | null;
};

/** Tradera-sök-URL för en produkt — ersätter en utgången direktlänk (alltid levande). */
export function traderaResetSearchUrl(p: TraderaResetProduct): string {
  const searchTerm = p.card
    ? `Pokemon ${p.card.name} ${p.card.set.name}`
    : /^pok[eé]mon/i.test(p.title) ? p.title : `Pokemon ${p.title}`;
  const catMap: Record<string, string> = {
    SINGLE_CARD: "SINGLE_CARD", BOOSTER_BOX: "BOOSTER_BOX",
    BOOSTER_PACK: "BOOSTER_PACK", ETB: "OTHER",
  };
  return traderaSearchUrlSpecific(searchTerm, catMap[p.category] ?? p.category);
}

/**
 * Får en Tradera-annons i kategori `listingCategoryId` bli offerten för en
 * produkt i kategori `productCategory`? Känd kategori på båda sidor måste tillhöra
 * samma form-grupp (pack ≠ box ≠ ETB ≠ singel). Okänd annonskategori → behåll den
 * gamla singel/icke-singel-vakten (en singelprodukt kräver kategoribekräftelse).
 */
export function traderaCategoryCompatible(
  productCategory: string,
  listingCategoryId: number | undefined
): boolean {
  const productGroup = PRODUCT_CAT_GROUP[productCategory] ?? "sealed";
  const listingGroup = listingCategoryId ? TRADERA_CAT_GROUP[listingCategoryId] : undefined;
  if (listingGroup) return listingGroup === productGroup;
  return productGroup !== "single";
}

// Samtidiga DB-anrop (≤ DB_POOL i db.ts) — matchning + skrivning är annars
// tusentals sekventiella cross-region-queries och jobbet timeoutar.
const DB_CONCURRENCY = 8;

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";

const POKEMON_CATEGORIES = [
  { id: 1001337, label: "Löskort", fallback: "SINGLE_CARD" },
  { id: 1001340, label: "Boosterboxar", fallback: "BOOSTER_BOX" },
  { id: 1001339, label: "Boosterpaket", fallback: "BOOSTER_PACK" },
  { id: 1001341, label: "Övrigt sealed", fallback: "OTHER" },
] as const;

// ─── XML helpers ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function termAttributeValues(block: string, attrName: string): string[] {
  const m = block.match(
    new RegExp(`<Name>${attrName}</Name>([\\s\\S]*?)</TermAttributeValues>`)
  );
  if (!m) return [];
  return [...m[1].matchAll(/>([^<>]+)</g)]
    .map((x) => decodeEntities(x[1].trim()))
    .filter((v) => v.length > 0);
}

// ─── Item type ───────────────────────────────────────────────────────────────

export interface TraderaItem {
  itemId: string;
  title: string;
  priceOre: number;
  url: string;
  imageUrl?: string;
  categoryId?: number;
  sellerId?: number;
}

/** Max lagrade skena-annonser per produkt (produktsidans "Fler annonser på Tradera"). */
export const MAX_RAIL_LISTINGS = 20;

/** Skena-rader äldre än så purgas (produkter som roterat ut ur sökbudgeten). */
const RAIL_PURGE_DAYS = 7;

/**
 * Fas 0-urval för EN produkt (ren funktion, före pris-vakten): alla annonser som
 * passerar avvisade LLM-domar, kategori-grupp, språk och titelmatch. Språkvakten
 * är NY mot gamla billigast-logiken — katalogen håller EN och JP som SEPARATA
 * produkter, så en JP-annons får inte bli vare sig offer eller skena-rad på en
 * EN-produkt (och omvänt). Dedup på itemId (samma annons kan dyka upp flera
 * gånger i ett sök-svar).
 */
export function pickRailCandidates(
  items: TraderaItem[],
  product: {
    id: string;
    category: string;
    language: string;
    normalizedTitle: string;
    card: { name: string; number: string } | null;
  },
  rejected: ReadonlySet<string>
): TraderaItem[] {
  const seen = new Set<string>();
  const kept: TraderaItem[] = [];
  for (const item of items) {
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    if (rejected.has(`${item.itemId}|${product.id}`)) continue;
    if (!traderaCategoryCompatible(product.category, item.categoryId)) continue;
    if (listingCardLanguage(item.title, item.url) !== product.language) continue;
    if (matchListingToProduct(item.title, product) == null) continue;
    kept.push(item);
  }
  return kept;
}

function parseItemsFromXml(xml: string): { items: TraderaItem[]; totalPages: number } {
  const pagesText = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
  const totalPages = pagesText ? parseInt(pagesText[1], 10) : 1;

  const blocks = [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
  const items: TraderaItem[] = [];

  for (const block of blocks) {
    const itemId = tagText(block, "Id");
    const title = tagText(block, "ShortDescription");
    if (!itemId || !title) continue;

    const binText = tagText(block, "BuyItNowPrice");
    const bin = binText ? parseInt(binText, 10) : NaN;
    if (!Number.isFinite(bin) || bin <= 0) continue;

    if (tagText(block, "IsEnded") === "true") continue;
    const itemType = tagText(block, "ItemType") ?? "";
    if (itemType !== "PureBuyItNow" && tagText(block, "HasBids") === "true") continue;

    const lang = termAttributeValues(block, "pokemon_language")[0];
    if (lang && !/^eng/i.test(lang)) continue;

    const rawUrl = tagText(block, "ItemLink") ?? tagText(block, "ItemUrl");
    // Vissa API-svar lägger BILD-URL:en (img.tradera.net/...jpg) i länkfältet —
    // 13 offers i prod pekade på en jpg. Allt som inte är en annons-länk på
    // tradera.com faller tillbaka på den konstruerade item-URL:en (fungerar alltid).
    const url =
      rawUrl && /tradera\.com\/item\//.test(rawUrl)
        ? rawUrl.replace(/^http:\/\//, "https://")
        : `https://www.tradera.com/item/0/${itemId}/`;

    // SPRÅKVAKT. pokemon_language-attributet ovan är TOMT hos de flesta privat-
    // säljare, så det ensamt släppte igenom spanska/tyska/kinesiska annonser rakt
    // in i katalogen — Tradera hade i praktiken ingen språkkontroll alls. Kör samma
    // detektor som butiks-importen (titel + URL-slug): katalogen är EN + JP only.
    if (isBlockedListingLanguage(title, url)) continue;

    const catText = tagText(block, "CategoryId");
    const sellerBlock = block.match(/<Seller>([\s\S]*?)<\/Seller>/);
    const sellerIdText = sellerBlock
      ? tagText(sellerBlock[1], "Id")
      : tagText(block, "SellerId");

    // Annonsens egen miniatyr (skenan visar säljarens foto, inte katalogbilden).
    // API:t ger /thumbs/ = 64x64 — oanvändbart suddigt uppskalat i skenan.
    // Samma CDN-path serverar större varianter; /medium-fit/ = 600x460 (~60 KB),
    // lagom för ett ~176 px-kort på 3x-skärm.
    const thumb = tagText(block, "ThumbnailLink")?.replace("/thumbs/", "/medium-fit/");

    items.push({
      itemId,
      title,
      priceOre: bin * 100,
      url,
      imageUrl: thumb && /^https?:\/\//.test(thumb) ? thumb : undefined,
      categoryId: catText ? parseInt(catText, 10) : undefined,
      sellerId: sellerIdText ? parseInt(sellerIdText, 10) : undefined,
    });
  }

  return { items, totalPages };
}

// ─── API callers ─────────────────────────────────────────────────────────────

async function callApi(
  endpoint: string, body: string, action: string,
  appId: string, appKey: string
): Promise<string> {
  const res = await fetch(`${endpoint}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"http://api.tradera.com/${action}"`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.text();
}

// ─── SOAP envelopes ──────────────────────────────────────────────────────────

function soapHeader(appId: string, appKey: string): string {
  return `<soap:Header>
    <trad:AuthenticationHeader>
      <trad:AppId>${appId}</trad:AppId>
      <trad:AppKey>${appKey}</trad:AppKey>
    </trad:AuthenticationHeader>
    <trad:ConfigurationHeader>
      <trad:Sandbox>0</trad:Sandbox>
      <trad:MaxResultAge>0</trad:MaxResultAge>
    </trad:ConfigurationHeader>
  </soap:Header>`;
}

type SearchFn = (catId: number, page: number, priceMin?: number, priceMax?: number) => Promise<string>;

function makeSearchFns(appId: string, appKey: string): { name: string; fn: SearchFn }[] {
  return [
    // 1. SearchService.Search (PriceAsc)
    {
      name: "SS.Search",
      fn: (catId, page) => callApi(SEARCH_API,
        `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Search xmlns="http://api.tradera.com"><query>pokemon</query><categoryId>${catId}</categoryId><pageNumber>${page}</pageNumber><orderBy>PriceAscending</orderBy></Search></soap:Body></soap:Envelope>`,
        "Search", appId, appKey),
    },
    // 2. SearchService.SearchAdvanced (price ranges)
    {
      name: "SS.SearchAdv",
      fn: (catId, page, priceMin, priceMax) => callApi(SEARCH_API,
        `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords>pokemon</SearchWords><CategoryId>${catId}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${page}</PageNumber><OrderBy>PriceAscending</OrderBy><ItemStatus>Active</ItemStatus><ItemType>BuyItNow</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail>${priceMin != null ? `<PriceMinimum>${priceMin}</PriceMinimum>` : ""}${priceMax != null ? `<PriceMaximum>${priceMax}</PriceMaximum>` : ""}</request></SearchAdvanced></soap:Body></soap:Envelope>`,
        "SearchAdvanced", appId, appKey),
    },
    // 3. PublicService.GetSearchResult (EndDate sorting — different slice)
    {
      name: "PS.GetSR",
      fn: (catId, page) => callApi(PUBLIC_API,
        `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com">${soapHeader(appId, appKey)}<soap:Body><trad:GetSearchResult><trad:query>pokemon</trad:query><trad:categoryId>${catId}</trad:categoryId><trad:pageNumber>${page}</trad:pageNumber><trad:orderBy>EndDateAscending</trad:orderBy></trad:GetSearchResult></soap:Body></soap:Envelope>`,
        "GetSearchResult", appId, appKey),
    },
    // 4. PublicService.GetSearchResultAdvanced (price ranges)
    {
      name: "PS.GetSRAdv",
      fn: (catId, page, priceMin, priceMax) => callApi(PUBLIC_API,
        `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com">${soapHeader(appId, appKey)}<soap:Body><trad:GetSearchResultAdvanced><trad:query><trad:SearchWords>pokemon</trad:SearchWords><trad:CategoryId>${catId}</trad:CategoryId><trad:SearchInDescription>false</trad:SearchInDescription><trad:Mode>AllWords</trad:Mode><trad:PriceMinimum>${priceMin ?? 0}</trad:PriceMinimum><trad:PriceMaximum>${priceMax ?? 999999}</trad:PriceMaximum><trad:BidsMinimum>0</trad:BidsMinimum><trad:BidsMaximum>0</trad:BidsMaximum><trad:CountyId>0</trad:CountyId><trad:OrderBy>PriceAscending</trad:OrderBy><trad:ItemStatus>Active</trad:ItemStatus><trad:ItemType>FixedPrice</trad:ItemType><trad:OnlyAuctionsWithBuyNow>false</trad:OnlyAuctionsWithBuyNow><trad:OnlyItemsWithThumbnail>false</trad:OnlyItemsWithThumbnail><trad:ItemsPerPage>50</trad:ItemsPerPage><trad:PageNumber>${page}</trad:PageNumber><trad:ItemCondition>All</trad:ItemCondition><trad:SellerType>All</trad:SellerType></trad:query></trad:GetSearchResultAdvanced></soap:Body></soap:Envelope>`,
        "GetSearchResultAdvanced", appId, appKey),
    },
    // 5. PublicService.GetSearchResultAdvancedXml (yet another price slice)
    {
      name: "PS.GetSRAdvXml",
      fn: (catId, page, priceMin, priceMax) => {
        const q = `<Query><SearchWords>pokemon</SearchWords><CategoryId>${catId}</CategoryId><SearchInDescription>false</SearchInDescription><Mode>AllWords</Mode><PriceMinimum>${priceMin ?? 0}</PriceMinimum><PriceMaximum>${priceMax ?? 999999}</PriceMaximum><BidsMinimum>0</BidsMinimum><BidsMaximum>0</BidsMaximum><CountyId>0</CountyId><OrderBy>PriceAscending</OrderBy><ItemStatus>Active</ItemStatus><ItemType>FixedPrice</ItemType><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail><ItemsPerPage>50</ItemsPerPage><PageNumber>${page}</PageNumber><ItemCondition>All</ItemCondition><SellerType>All</SellerType></Query>`;
        return callApi(PUBLIC_API,
          `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com">${soapHeader(appId, appKey)}<soap:Body><trad:GetSearchResultAdvancedXml><trad:queryXml>${esc(q)}</trad:queryXml></trad:GetSearchResultAdvancedXml></soap:Body></soap:Envelope>`,
          "GetSearchResultAdvancedXml", appId, appKey);
      },
    },
  ];
}

// ─── Targeted per-product search (hot-products phase) ────────────────────────

/**
 * Riktad SearchAdvanced på en specifik produkt (namn + kategori), billigast först.
 * Den breda svepet paginerar bara några sidor per priskategori och missar därför
 * ofta den billigaste annonsen för en enskild populär produkt — en namn-specifik
 * sökning går rakt på den. Använder samma SearchAdvanced-metod som SS.SearchAdv.
 */
function searchAdvancedFor(
  appId: string, appKey: string, words: string, catId: number
): Promise<string> {
  return callApi(SEARCH_API,
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords>${esc(words)}</SearchWords><CategoryId>${catId}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>1</PageNumber><OrderBy>PriceAscending</OrderBy><ItemStatus>Active</ItemStatus><ItemType>BuyItNow</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`,
    "SearchAdvanced", appId, appKey);
}

// ─── Price ranges: spread calls across different price bands ─────────────────

interface PriceRange { min?: number; max?: number; label: string }

const PRICE_RANGES: PriceRange[] = [
  { min: 0, max: 30, label: "0-30kr" },
  { min: 30, max: 80, label: "30-80kr" },
  { min: 80, max: 200, label: "80-200kr" },
  { min: 200, max: 500, label: "200-500kr" },
  { min: 500, max: 2000, label: "500-2000kr" },
  { min: 2000, label: "2000+kr" },
];

// ─── Public API ──────────────────────────────────────────────────────────────

export interface TraderaSweepOptions {
  dryRun?: boolean;
  /** Dagar utan en enda återfunnen levande annons innan offerten nollställs (default 3). */
  expiryDays?: number;
  /** Loggfunktion (default console.log). */
  log?: (msg: string) => void;
}

export interface TraderaSweepResult {
  apiCalls: number;
  itemsFetched: number;
  matchedProducts: number;
  written: number;
  priceUpdated: number;
  unchanged: number;
  expired: number;
  withPrice: number;
  withoutPrice: number;
  /** Skena-rader (#19) lagrade denna körning. */
  listingsStored: number;
}

/**
 * Kör en komplett Tradera-svepning. Returnerar en sammanfattning.
 * Kräver TRADERA_APP_ID / TRADERA_APP_KEY i miljön.
 */
export async function runTraderaSweep(
  opts: TraderaSweepOptions = {}
): Promise<TraderaSweepResult> {
  const dryRun = opts.dryRun ?? false;
  // 3 dagar: skriv-logiken byter länk direkt när en produkt återfinns levande,
  // så expiry rör bara produkter med NOLL levande annonser. Då är en sök-URL
  // alltid giltig medan en kvarhängande direktlänk är direkt fel → snabbare
  // gallring vinner. Phase 0 skyddar populära produkter mot falsk-expiry.
  const expiryDays = opts.expiryDays ?? 3;
  const log = opts.log ?? ((m: string) => console.log(m));

  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error("TRADERA_APP_ID/TRADERA_APP_KEY saknas i miljön");
  }

  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });
  const source = await prisma.scrapeSource.findFirst({
    where: { name: "Tradera" },
    select: { id: true },
  });

  // Kända felmatchningar/skräp (LLM-dömda av verifyTraderaMatches) — återskapa
  // ALDRIG, vare sig som offer eller skena-rad. Laddas FÖRE Fas 0 (som numera
  // också konsumerar den) och återanvänds i skrivfasen.
  const rejected = new Set(
    (await prisma.traderaMatch.findMany({ where: { ok: false }, select: { itemId: true, productId: true } }))
      .map((m) => `${m.itemId}|${m.productId}`)
  );

  const allItems = new Map<string, TraderaItem>();
  const sellerCounts = new Map<number, number>();
  const callsByMethod: Record<string, number> = {};

  const searchFns = makeSearchFns(appId, appKey);

  // ── Fas 0: Riktade namn-sökningar (roterande full-katalog) ────────────
  // Vi namn-söker en produkt i taget och matchar träffarna DIREKT mot just den
  // produkten (matchListingToProduct) — ingen katalog-bred matchProduct-scan per
  // annons. Det gör Fas 0 billig nog att skala till tusentals produkter/dygn och
  // tar bort risken för kors-match. Budget = sökningar/körning; roterar äldst-
  // först → hela katalogen täcks över tid (höj budgeten närmare 10000/dygn-kvoten
  // för snabbare täckning). TRADERA_HOT_LIMIT = alias. Parallellt (per-minut =
  // Unlimited hos Tradera) så stora budgetar ryms inom körningens tidsgräns.
  const SEARCH_BUDGET = parseInt(
    process.env.TRADERA_SEARCH_BUDGET ?? process.env.TRADERA_HOT_LIMIT ?? "200",
    10
  );
  const SEARCH_CONCURRENCY = parseInt(process.env.TRADERA_SEARCH_CONCURRENCY ?? "6", 10);
  let hotCalls = 0;
  // Produkter vi FAKTISKT namn-sökte denna körning. Bara dessa får nollställas i
  // Fas 3 (annars gömdes giltiga länkar för produkter vi inte ens kollade om).
  const searchedProductIds = new Set<string>();
  // Direkt-matchade Fas 0-träffar (productId → billigaste rimliga annons).
  const directMatches = new Map<string, { price: number; item: TraderaItem }>();
  // Skena-rader (#19): ALLA vakt-passerade annonser per namn-sökt produkt
  // (billigast först, max MAX_RAIL_LISTINGS) — inte bara den billigaste.
  const railRows: {
    productId: string; itemId: string; title: string;
    price: number; url: string; imageUrl: string | null;
  }[] = [];
  if (SEARCH_BUDGET > 0) {
    log("📡 Fas 0: Riktade namn-sökningar (roterande full-katalog, direkt-match)...");
    const hot = await prisma.product.findMany({
      where: { category: { not: "ACCESSORY" } },
      select: {
        id: true, title: true, normalizedTitle: true, category: true, language: true,
        card: { select: { name: true, number: true, set: { select: { name: true } } } },
      },
      orderBy: [
        { watchlistItems: { _count: "desc" } },
        { traderaCheckedAt: { sort: "asc", nulls: "first" } },
        { viewCount: "desc" },
      ],
      take: SEARCH_BUDGET,
    });
    let quotaHit = false;
    await mapPool(hot, SEARCH_CONCURRENCY, async (p) => {
      if (quotaHit) return;
      const words = p.card ? `${p.card.name} ${p.card.set.name}` : p.title;
      const catId = p.card ? TRADERA_CATEGORY.SINGLE_CARD : (TRADERA_CATEGORY[p.category] ?? 293307);
      let result;
      try {
        const xml = await searchAdvancedFor(appId, appKey, words, catId);
        result = parseItemsFromXml(xml);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.includes("AboveCallLimit")) quotaHit = true;
        return;
      }
      hotCalls++;
      searchedProductIds.add(p.id);

      for (const item of result.items) {
        if (item.sellerId) sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) ?? 0) + 1);
      }

      // Alla annonser som genuint matchar JUST denna produkt — inte bara den
      // billigaste. Pris-vakten hämtar facit EN gång per produkt (samma DB-last
      // som gamla en-annons-kollen) och appliceras rent per annons.
      const candidates = pickRailCandidates(result.items, p, rejected);
      if (candidates.length === 0) return;
      const plausible = await getListingPriceGuard(p.id);
      const kept = candidates
        .filter((c) => plausible(c.priceOre))
        .sort((a, b) => a.priceOre - b.priceOre)
        .slice(0, MAX_RAIL_LISTINGS);
      if (kept.length === 0) return;

      directMatches.set(p.id, { price: kept[0].priceOre, item: kept[0] });
      for (const c of kept) {
        railRows.push({
          productId: p.id, itemId: c.itemId, title: c.title,
          price: c.priceOre, url: c.url, imageUrl: c.imageUrl ?? null,
        });
      }
    });
    // Stämpla rotations-markören så nästa körning tar nästa batch (även vid kvot-stopp).
    if (searchedProductIds.size > 0 && !dryRun) {
      await prisma.product.updateMany({
        where: { id: { in: [...searchedProductIds] } },
        data: { traderaCheckedAt: new Date() },
      });
    }
    callsByMethod["Fas0.HotSearch"] = hotCalls;
    log(`   ${hotCalls} sökningar → ${directMatches.size} direkt-matchade produkter\n`);
  }

  // ── Fas 1: Bred sökning (sökmetoder × 100 anrop) ──────────────────────
  log("📡 Fas 1: Bred sökning...\n");

  for (const { name, fn } of searchFns) {
    // Fas 0 förbrukade SearchAdvanced-kvoten → hoppa över den breda varianten.
    if (hotCalls > 0 && name === "SS.SearchAdv") continue;
    let calls = 0;
    let quotaHit = false;
    const beforeCount = allItems.size;

    const supportsRanges = name.includes("Adv");
    const ranges: PriceRange[] = supportsRanges
      ? PRICE_RANGES
      : [{ label: "all" }];

    const pagesPerRange = Math.floor(100 / (ranges.length * POKEMON_CATEGORIES.length));

    for (const range of ranges) {
      if (quotaHit) break;
      for (const cat of POKEMON_CATEGORIES) {
        if (quotaHit) break;
        let totalPages = 1;
        for (let page = 1; page <= Math.min(pagesPerRange, totalPages) && calls < 100; page++) {
          try {
            const xml = await fn(cat.id, page, range.min, range.max);
            calls++;
            const result = parseItemsFromXml(xml);
            totalPages = result.totalPages;

            for (const item of result.items) {
              if (!allItems.has(item.itemId)) allItems.set(item.itemId, item);
              if (item.sellerId) sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) ?? 0) + 1);
            }
            if (result.items.length === 0) break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("429") || msg.includes("AboveCallLimit")) { quotaHit = true; break; }
            break;
          }
        }
      }
    }

    callsByMethod[name] = calls;
    const newItems = allItems.size - beforeCount;
    log(`   ${name}: ${calls} anrop → +${newItems} nya (${allItems.size} totalt)${quotaHit ? " [kvot slut]" : ""}`);
  }

  // ── Fas 2: Top-säljare (100 anrop) ─────────────────────────────────────
  log("\n📡 Fas 2: Top-säljare (GetSellerItems)...");

  const topSellers = [...sellerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([id]) => id);

  let sellerCalls = 0;
  const beforeSeller = allItems.size;

  for (const sellerId of topSellers) {
    if (sellerCalls >= 100) break;
    for (const cat of POKEMON_CATEGORIES) {
      if (sellerCalls >= 100) break;
      try {
        const xml = await callApi(PUBLIC_API,
          `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com">${soapHeader(appId, appKey)}<soap:Body><trad:GetSellerItems><trad:userId>${sellerId}</trad:userId><trad:categoryId>${cat.id}</trad:categoryId><trad:filterActive>Active</trad:filterActive><trad:filterItemType>PureBuyItNow</trad:filterItemType></trad:GetSellerItems></soap:Body></soap:Envelope>`,
          "GetSellerItems", appId, appKey);
        sellerCalls++;
        const result = parseItemsFromXml(xml);
        for (const item of result.items) {
          if (!allItems.has(item.itemId)) allItems.set(item.itemId, item);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.includes("AboveCallLimit")) break;
      }
    }
  }
  callsByMethod["PS.GetSellerItems"] = sellerCalls;
  log(`   ${sellerCalls} anrop, ${topSellers.length} säljare → +${allItems.size - beforeSeller} nya (${allItems.size} totalt)`);

  // ── Summering ──────────────────────────────────────────────────────────
  const totalCalls = Object.values(callsByMethod).reduce((a, b) => a + b, 0);
  log(`\n📦 Totalt: ${allItems.size} unika annonser (${totalCalls} API-anrop)`);

  // ── Matchning ──────────────────────────────────────────────────────────
  log("\n🔗 Matchar mot databasen...");

  let matched = 0, noMatch = 0, implausible = 0, categoryMismatch = 0;
  const bestByProduct = new Map<string, { price: number; item: TraderaItem }>();

  const itemsArr = [...allItems.values()];
  let processed = 0;
  await mapPool(itemsArr, DB_CONCURRENCY, async (item) => {
    if (++processed % 2000 === 0) log(`   [${processed}/${itemsArr.length}] matchade: ${matched}`);

    const normalized = normalizeTitle(item.title);
    const match = await matchProduct(normalized);
    if (!match) { noMatch++; return; }

    const product = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { id: true, category: true },
    });
    if (!product) { noMatch++; return; }

    if (!traderaCategoryCompatible(product.category, item.categoryId)) { categoryMismatch++; return; }

    if (!(await isPlausibleListingPrice(product.id, item.priceOre))) { implausible++; return; }

    matched++;
    // get+set utan await emellan → atomiskt per task, säkert under mapPool.
    const existing = bestByProduct.get(product.id);
    if (!existing || item.priceOre < existing.price) {
      bestByProduct.set(product.id, { price: item.priceOre, item });
    }
  });

  // Slå ihop Fas 0:s direkt-matchningar (billigast vinner). De har redan passerat
  // kategori- + pris-vakten, så de läggs in rakt av.
  for (const [productId, hit] of directMatches) {
    const existing = bestByProduct.get(productId);
    if (!existing || hit.price < existing.price) bestByProduct.set(productId, hit);
  }

  log(`   Matchade: ${matched} pool-annonser + ${directMatches.size} direkt (Fas 0) → ${bestByProduct.size} unika produkter`);
  log(`   Ej matchade: ${noMatch} | Kategorifel: ${categoryMismatch} | Orimligt pris: ${implausible}`);

  let written = 0;
  let priceUpdated = 0;
  let unchanged = 0;
  let expired = 0;
  let listingsStored = 0;

  // ── Skriv till DB ──────────────────────────────────────────────────────
  if (!dryRun) {
    log("\n💾 Uppdaterar databasen...");

    let skippedRejects = 0;

    await mapPool([...bestByProduct.entries()], DB_CONCURRENCY, async ([productId, { price, item }]) => {
      if (rejected.has(`${item.itemId}|${productId}`)) {
        skippedRejects++;
        return;
      }
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { category: true },
      });
      const condition =
        product?.category === "SINGLE_CARD" || product?.category === "GRADED_CARD"
          ? "NEAR_MINT" : "SEALED";
      // Språket hårdkodades tidigare till "EN" på VARJE Tradera-offer — en japansk
      // annons låg alltså som engelsk. Blockade språk är redan bortsållade vid
      // ingest, så detta är EN eller JP.
      const offerLanguage = listingCardLanguage(item.title, item.url);

      const existingOffer = await prisma.offer.findUnique({
        where: {
          productId_retailerId_condition_language: {
            productId,
            retailerId: tradera.id,
            condition,
            language: offerLanguage,
          },
        },
        select: { id: true, price: true, url: true },
      });

      // Skriv ALLTID denna körnings billigaste LEVANDE annons — behåll inte ett
      // lagrat "billigare" pris, för den annonsen kan ha löpt ut/sålts sedan dess
      // (Tradera-annonser är kortlivade). Att behålla den pinnar fast en död länk
      // och bump:ar lastSeenAt så expiry aldrig slår till. Den färska annonsen är
      // det ärliga aktuella priset, även när den är dyrare (den billiga såldes).
      if (existingOffer?.price != null) {
        if (price < existingOffer.price) priceUpdated++;
        else if (price === existingOffer.price) unchanged++;
      }
      await prisma.offer.upsert({
        where: {
          productId_retailerId_condition_language: {
            productId,
            retailerId: tradera.id,
            condition,
            language: offerLanguage,
          },
        },
        update: {
          price,
          currency: "SEK",
          stockStatus: StockStatus.IN_STOCK,
          url: item.url,
          lastSeenAt: new Date(),
        },
        create: {
          productId,
          retailerId: tradera.id,
          price,
          currency: "SEK",
          stockStatus: StockStatus.IN_STOCK,
          url: item.url,
          condition,
          language: offerLanguage,
          lastSeenAt: new Date(),
        },
      });
      written++;

      if (source) {
        await prisma.priceObservation.create({
          data: {
            productId,
            sourceId: source.id,
            price,
            currency: "SEK",
            condition,
            rawData: {
              itemId: item.itemId,
              title: item.title,
              priceOre: price,
              url: item.url,
              source: "tradera-sweep",
            },
          },
        });
      }
    });

    log(`   ✅ ${written} nya/uppdaterade, ${priceUpdated} billigare pris, ${unchanged} redan billigare${skippedRejects ? `, ${skippedRejects} hoppade (känd felmatch)` : ""}`);

    // ── Skena-annonser (#19): ersätt HELA settet per namn-sökt produkt ──────
    // Sökta produkter utan träffar får sina gamla rader raderade (annonserna är
    // borta) och produkter som roterat ut ur budgeten purgas på ålder — sidan
    // visar dessutom aldrig rader äldre än några dagar (bältet + hängslena).
    if (searchedProductIds.size > 0) {
      await prisma.traderaListing.deleteMany({
        where: { productId: { in: [...searchedProductIds] } },
      });
      for (let i = 0; i < railRows.length; i += 1000) {
        const res = await prisma.traderaListing.createMany({
          data: railRows.slice(i, i + 1000),
          skipDuplicates: true,
        });
        listingsStored += res.count;
      }
      const purgeCutoff = new Date();
      purgeCutoff.setDate(purgeCutoff.getDate() - RAIL_PURGE_DAYS);
      const purged = await prisma.traderaListing.deleteMany({
        where: { lastSeenAt: { lt: purgeCutoff } },
      });
      log(`   📋 Skena: ${listingsStored} annonser lagrade (${searchedProductIds.size} sökta produkter, ${purged.count} gamla purgade)`);
    }

    // ── Fas 3: Expiry — nollställ utgångna listings ────────────────────
    // BARA produkter vi NAMN-SÖKTE denna körning (searchedProductIds) får
    // nollställas. Med roterande full-katalog-svep hinner vi inte se varje
    // produkts annons varje körning → utan denna spärr gömdes giltiga direkt-
    // länkar för produkter vi inte ens kollade om (= huvudbuggen).
    log(`\n🕐 Fas 3: Expiry (namn-sökta utan färsk träff på ${expiryDays} dagar)...`);

    const expiryCutoff = new Date();
    expiryCutoff.setDate(expiryCutoff.getDate() - expiryDays);

    const staleOffers = await prisma.offer.findMany({
      where: {
        retailerId: tradera.id,
        price: { not: null },
        lastSeenAt: { lt: expiryCutoff },
        productId: { in: [...searchedProductIds] },
      },
      select: {
        id: true,
        productId: true,
        product: {
          select: {
            title: true,
            category: true,
            card: {
              select: {
                name: true,
                number: true,
                set: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    await mapPool(staleOffers, DB_CONCURRENCY, async (offer) => {
      const searchUrl = traderaResetSearchUrl(offer.product);

      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          price: null,
          stockStatus: StockStatus.UNKNOWN,
          url: searchUrl,
        },
      });
      expired++;
    });

    log(`   ${expired} offers nollställda (troligen utgångna annonser)`);
  }

  // ── Slutsummering ─────────────────────────────────────────────────────
  const withPrice = await prisma.offer.count({
    where: { retailerId: tradera.id, price: { not: null } },
  });
  const withoutPrice = await prisma.offer.count({
    where: { retailerId: tradera.id, price: null },
  });

  log(`\n🎉 Klart!`);
  log(`   API-anrop:          ${totalCalls}`);
  log(`   Annonser hämtade:   ${allItems.size}`);
  log(`   Matchade produkter: ${bestByProduct.size}`);
  log(`   Tradera med pris:   ${withPrice} (${(withPrice / (withPrice + withoutPrice) * 100).toFixed(1)}%)`);
  log(`   Tradera sök-URL:    ${withoutPrice}`);
  if (dryRun) log("   ⚠️ DRY_RUN — inga ändringar gjorda");

  return {
    apiCalls: totalCalls,
    itemsFetched: allItems.size,
    matchedProducts: bestByProduct.size,
    written,
    priceUpdated,
    unchanged,
    expired,
    withPrice,
    withoutPrice,
    listingsStored,
  };
}
