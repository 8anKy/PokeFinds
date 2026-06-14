/**
 * Daglig Tradera-svepning — kärnlogik (delas av CLI-script + jobb-worker).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Budget: 600 anrop/24h (6 metoder × 100 egen kvot), Unlimited/min    │
 * │                                                                     │
 * │  Fas 1 (≤500 anrop): Bred sökning — 5 sökmetoder × 100 anrop         │
 * │  Fas 2 (≤100 anrop): Top-säljare — GetSellerItems                    │
 * │  Fas 3 (0 anrop):    Expiry — nollställ offer ej sedda på X dagar    │
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
import { normalizeTitle } from "../lib/utils";
import { matchProduct, isPlausibleListingPrice } from "../scrapers/matching";
import { traderaSearchUrlSpecific } from "../lib/marketplace-urls";

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

interface TraderaItem {
  itemId: string;
  title: string;
  priceOre: number;
  url: string;
  categoryId?: number;
  sellerId?: number;
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
    const url = rawUrl
      ? rawUrl.replace(/^http:\/\//, "https://")
      : `https://www.tradera.com/item/0/${itemId}/`;

    const catText = tagText(block, "CategoryId");
    const sellerBlock = block.match(/<Seller>([\s\S]*?)<\/Seller>/);
    const sellerIdText = sellerBlock
      ? tagText(sellerBlock[1], "Id")
      : tagText(block, "SellerId");

    items.push({
      itemId,
      title,
      priceOre: bin * 100,
      url,
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
  /** Dagar innan en oförnyad listing anses utgången och nollställs. */
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
}

/**
 * Kör en komplett Tradera-svepning. Returnerar en sammanfattning.
 * Kräver TRADERA_APP_ID / TRADERA_APP_KEY i miljön.
 */
export async function runTraderaSweep(
  opts: TraderaSweepOptions = {}
): Promise<TraderaSweepResult> {
  const dryRun = opts.dryRun ?? false;
  const expiryDays = opts.expiryDays ?? 7;
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

  const allItems = new Map<string, TraderaItem>();
  const sellerCounts = new Map<number, number>();
  const callsByMethod: Record<string, number> = {};

  const searchFns = makeSearchFns(appId, appKey);

  // ── Fas 1: Bred sökning (5 metoder × 100 anrop) ───────────────────────
  log("📡 Fas 1: Bred sökning (5 sökmetoder)...\n");

  for (const { name, fn } of searchFns) {
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
  const SINGLE_CATEGORIES = new Set(["SINGLE_CARD", "GRADED_CARD"]);

  let matched = 0, noMatch = 0, implausible = 0, categoryMismatch = 0;
  const bestByProduct = new Map<string, { price: number; item: TraderaItem }>();

  let i = 0;
  for (const item of allItems.values()) {
    i++;
    if (i % 2000 === 0) log(`   [${i}/${allItems.size}] matchade: ${matched}`);

    const normalized = normalizeTitle(item.title);
    const match = await matchProduct(normalized);
    if (!match) { noMatch++; continue; }

    const product = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { id: true, category: true },
    });
    if (!product) { noMatch++; continue; }

    const isSingleListing = item.categoryId === 1001337;
    const isSingleProduct = SINGLE_CATEGORIES.has(product.category);
    if (isSingleListing !== isSingleProduct) { categoryMismatch++; continue; }

    if (!(await isPlausibleListingPrice(product.id, item.priceOre))) { implausible++; continue; }

    matched++;
    const existing = bestByProduct.get(product.id);
    if (!existing || item.priceOre < existing.price) {
      bestByProduct.set(product.id, { price: item.priceOre, item });
    }
  }

  log(`   Matchade: ${matched} annonser → ${bestByProduct.size} unika produkter`);
  log(`   Ej matchade: ${noMatch} | Kategorifel: ${categoryMismatch} | Orimligt pris: ${implausible}`);

  let written = 0;
  let priceUpdated = 0;
  let unchanged = 0;
  let expired = 0;

  // ── Skriv till DB ──────────────────────────────────────────────────────
  if (!dryRun) {
    log("\n💾 Uppdaterar databasen...");

    for (const [productId, { price, item }] of bestByProduct) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { category: true },
      });
      const condition =
        product?.category === "SINGLE_CARD" || product?.category === "GRADED_CARD"
          ? "NEAR_MINT" : "SEALED";

      const existingOffer = await prisma.offer.findUnique({
        where: {
          productId_retailerId_condition_language: {
            productId,
            retailerId: tradera.id,
            condition,
            language: "EN",
          },
        },
        select: { id: true, price: true, url: true },
      });

      if (existingOffer?.price != null && existingOffer.price <= price) {
        // Befintligt pris är redan billigare — uppdatera bara lastSeenAt
        await prisma.offer.update({
          where: { id: existingOffer.id },
          data: { lastSeenAt: new Date() },
        });
        unchanged++;
      } else {
        // Nytt billigare pris eller ingen offer ännu
        if (existingOffer?.price != null && price < existingOffer.price) priceUpdated++;
        await prisma.offer.upsert({
          where: {
            productId_retailerId_condition_language: {
              productId,
              retailerId: tradera.id,
              condition,
              language: "EN",
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
            language: "EN",
            lastSeenAt: new Date(),
          },
        });
        written++;
      }

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
    }

    log(`   ✅ ${written} nya/uppdaterade, ${priceUpdated} billigare pris, ${unchanged} redan billigare`);

    // ── Fas 3: Expiry — nollställ utgångna listings ────────────────────
    log(`\n🕐 Fas 3: Expiry (offers ej sedda på ${expiryDays} dagar)...`);

    const expiryCutoff = new Date();
    expiryCutoff.setDate(expiryCutoff.getDate() - expiryDays);

    const staleOffers = await prisma.offer.findMany({
      where: {
        retailerId: tradera.id,
        price: { not: null },
        lastSeenAt: { lt: expiryCutoff },
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

    for (const offer of staleOffers) {
      const p = offer.product;
      let searchTerm: string;
      if (p.card) {
        searchTerm = `Pokemon ${p.card.name} ${p.card.set.name}`;
      } else {
        searchTerm = /^pok[eé]mon/i.test(p.title) ? p.title : `Pokemon ${p.title}`;
      }
      const catMap: Record<string, string> = {
        SINGLE_CARD: "SINGLE_CARD",
        BOOSTER_BOX: "BOOSTER_BOX",
        BOOSTER_PACK: "BOOSTER_PACK",
        ETB: "OTHER",
      };
      const searchUrl = traderaSearchUrlSpecific(
        searchTerm,
        catMap[p.category] ?? p.category
      );

      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          price: null,
          stockStatus: StockStatus.UNKNOWN,
          url: searchUrl,
        },
      });
      expired++;
    }

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
  };
}
