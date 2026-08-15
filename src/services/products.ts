/**
 * Produkttjänster: sökning, detaljer, prishistorik och liknande produkter.
 * Rena funktioner utan framework-beroenden.
 */
import { prisma, withDbRetry } from "@/lib/db";
import { cachedRead, singleFlight } from "@/lib/cache";
import { normalizeTitle, utcDaysAgo, utcToday } from "@/lib/utils";
import { ServiceError } from "@/lib/errors";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { visibleListings } from "@/lib/listing-plausibility";
import { compareCardNumbers } from "@/lib/card-number-order";
import { PRINT_VARIANT_LABELS, REVERSE_VARIANT_LABELS } from "@/lib/print-variant";
import { favoriteSetIds } from "@/lib/user-preferences";
import { NOT_HIDDEN, NOT_HIDDEN_SQL } from "@/lib/product-visibility";
import { getTrendingLift } from "@/services/market";
import {
  bestMatchScore,
  EMPTY_PERSONAL,
  type PersonalContext,
  type QualityInput,
} from "@/services/ranking";
import type {
  CardLanguage,
  Prisma,
  ProductCategory,
  StockStatus,
} from "@prisma/client";

export type ProductSort =
  // Katalogens standard. Utan sökord = produktens kvalitetspoäng (Product.rankScore);
  // med sökord = relevans × kvalitet, plus ett lyft för dina egna bevakningar/samling.
  // Se src/services/ranking.ts.
  | "best_match"
  | "price_asc"
  | "price_desc"
  | "biggest_drop"
  // "popular" (ren 30-dagars engagemangsvolym) är BORTA ur filtret 2026-07-29 och
  // ersatt av best_match. Värdet accepteras fortfarande av API/URL:er — gamla länkar
  // och bokmärken ska inte gå sönder — men mappas till best_match av normalizeSort().
  | "popular"
  | "recently_restocked"
  | "most_watched"
  | "trending"
  | "deals"
  | "card_number_asc"
  | "card_number_desc"
  | "title_asc"
  | "title_desc"
  // ADMIN-ONLY (2026-08-13). Nyast skapade produkt först — driftvy, inte
  // produktfunktion: en besökare bryr sig om vad varan kostar, inte om vilken natt
  // vår auto-import råkade skapa raden. Den finns för att kunna granska vad en ny
  // butiksvåg drog in (wave 5 skapade 898 produkter på en natt, varav 118 skulle
  // aldrig ha kommit in). Grinden sitter i /produkter, som redan läser sessionen.
  | "recently_added";

/** Gamla `popular` = dagens `best_match` (kvalitetspoängen innehåller engagemanget). */
export function normalizeSort(sort: ProductSort | undefined): ProductSort {
  return !sort || sort === "popular" ? "best_match" : sort;
}

/**
 * Sorteringar som ordnar på priset SJÄLVT — de kräver därför att produkten HAR ett
 * pris (se synlighetsvillkoret i buildProductWhere). "Största prisfall" hör INTE hit:
 * den ordnar på förändringen, och den räknas bara fram för produkter som redan har
 * prishistorik. Normaliserade värden (`normalizeSort`).
 */
const PRICE_SORTS = new Set<ProductSort>(["price_asc", "price_desc"]);

export interface SearchProductsParams {
  query?: string;
  // Kategori, butik och språk tar EN eller FLERA värden (katalogens "Fler filter"
  // är flerval). Ett ensamt värde behålls som giltig form så äldre anropare —
  // /api/products, desktop-sidofältets <select> — kan skicka en sträng som förut.
  category?: ProductCategory | ProductCategory[];
  setId?: string;
  retailerId?: string | string[];
  minPrice?: number; // öre
  maxPrice?: number; // öre
  stockStatus?: StockStatus;
  language?: CardLanguage | CardLanguage[];
  sort?: ProductSort;
  /**
   * Inloggad användare → "bäst matchning" lyfter det du själv bevakar/samlar på.
   * BARA dina egna data (bevakningar + samling); ingen beteendespårning per användare
   * finns eller ska finnas — analytics.ts strippar userId med flit.
   * Sätts INTE av publika/cachade anropare: personaliserade resultat går förbi cachen.
   */
  userId?: string;
  page: number;
  pageSize: number;
}

/** Normaliserar "ett värde | flera värden | inget" till en lista. */
function toList<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((v) => v != null) : [value];
}

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  category: ProductCategory;
  imageUrl: string | null;
  language: CardLanguage;
  setId: string | null;
  setName: string | null;
  // Katalogkortet visar namn, set och kortnummer som EGNA rader i stället för den
  // hopbakade titeln — se src/lib/product-display.ts.
  setTotalCards: number | null;
  cardName: string | null;
  cardNumber: string | null;
  cardRarity: string | null;
  variantLabel: string | null;
  lowestPrice: number | null; // öre, IN_STOCK prioriteras
  lowestPriceStockStatus: StockStatus | null;
  offerCount: number;
  inStockCount: number;
  watchCount: number;
  viewCount: number;
  priceChange7d: number | null; // öre
  priceChange7dPercent: number | null;
  lastRestockAt: Date | null;
  dealPercent?: number | null; // Fynd-feed: % under Cardmarket-referens (annars undefined)
  dealListingTitle?: string | null; // Fynd-feed: verifierad Tradera-annonstitel
}

/**
 * Ett "fynd" = en live Tradera-annons minst så här långt UNDER produktens
 * Cardmarket-referenspris. Global tröskel via env, default 30 %. Ren funktion → testbar.
 */
export const DEAL_MIN_DISCOUNT = Math.min(
  0.95,
  Math.max(0.05, (Number(process.env.DEAL_MIN_DISCOUNT_PCT) || 30) / 100)
);

/**
 * Övre tak: en rabatt STÖRRE än så här är nästan alltid skräp, inte ett fynd —
 * felmatchad Tradera-annons, auktions-startpris, eller en uppblåst CM-referens
 * (CM "From" är osmoothad → en enda feldyr/graderad annons drar upp riktmärket).
 * Läs-tids-filter (INGEN skrivvakt, historiken lämnas rå). Env-styrt, default 85 %.
 */
export const DEAL_MAX_DISCOUNT = Math.min(
  0.99,
  Math.max(DEAL_MIN_DISCOUNT, (Number(process.env.DEAL_MAX_DISCOUNT_PCT) || 85) / 100)
);

/** True om Tradera-priset (öre) ligger i fynd-bandet [min, max] under referenspriset. */
export function qualifiesAsDeal(
  traderaOre: number,
  referenceOre: number,
  minDiscount = DEAL_MIN_DISCOUNT,
  maxDiscount = DEAL_MAX_DISCOUNT
): boolean {
  if (referenceOre <= 0 || traderaOre <= 0) return false;
  const discount = 1 - traderaOre / referenceOre;
  return discount >= minDiscount && discount <= maxDiscount;
}

/** Max antal produkter som hämtas för beräknade sorteringar. */
const MAX_CANDIDATES = 500;

/**
 * SQL-villkor som speglar isDirectOfferUrl() (src/lib/marketplace-urls.ts):
 * sök-/bläddringslänkar + CM-redirecten exkluderas. Delas av pris-cachen och Fynd-feeden.
 */
export const DIRECT_URL_SQL = `
  lower(url) NOT LIKE '%/search%'
  AND lower(url) NOT LIKE '%searchstring=%'
  AND lower(url) NOT LIKE '%sokstr=%'
  AND lower(url) NOT LIKE '%funk=sok%'
  AND lower(url) NOT LIKE '%?query=%' AND lower(url) NOT LIKE '%&query=%'
  AND lower(url) NOT LIKE '%?q=%' AND lower(url) NOT LIKE '%&q=%'
  AND lower(url) NOT LIKE '%prices.pokemontcg.io/cardmarket%'
`;

// UTC, inte lokal midnatt: PriceSnapshot.date är en @db.Date som lagrar UTC-datumet,
// så ett lokalt fönster i UTC+2 börjar 22:00 dagen innan och drar in en extra dag.
const daysAgo = utcDaysAgo;

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    set: { select: { id: true; name: true; totalCards: true } };
    card: { select: { name: true; number: true; rarity: true } };
    offers: { select: { price: true; stockStatus: true; url: true } };
    priceSnapshots: { select: { date: true; avgPrice: true } };
    restockEvents: { select: { detectedAt: true } };
    _count: { select: { watchlistItems: true } };
  };
}>;

export function computeLowestPrice(
  offers: { price: number | null; stockStatus: StockStatus }[]
): { price: number | null; stockStatus: StockStatus | null } {
  // Länk-offers utan pris (null) eller 0 öre (€0,00 = inget riktigt pris) räknas
  // inte in i lägsta pris.
  const priced = offers.filter(
    (o): o is { price: number; stockStatus: StockStatus } => o.price !== null && o.price > 0
  );
  if (priced.length === 0) return { price: null, stockStatus: null };
  const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : priced;
  const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: best.price, stockStatus: best.stockStatus };
}

/** Prisförändring senaste 7 dagarna utifrån dagliga snapshots (öre + procent). */
export function computePriceChange7d(
  snapshots: { date: Date; avgPrice: number }[]
): { change: number | null; percent: number | null } {
  if (snapshots.length < 2) return { change: null, percent: null };
  const sorted = [...snapshots].sort((a, b) => a.date.getTime() - b.date.getTime());
  const oldest = sorted[0];
  const latest = sorted[sorted.length - 1];
  if (oldest.avgPrice <= 0) return { change: null, percent: null };
  const change = latest.avgPrice - oldest.avgPrice;
  const percent = Math.round((change / oldest.avgPrice) * 10000) / 100;
  return { change, percent };
}

function toListItem(p: ProductWithRelations): ProductListItem {
  // Endast offers med direkt produktlänk räknas — exakt som produktsidan.
  // Sök-/bläddringslänkar (Cardmarket-sök, CM-redirect, utgångna Tradera-annonser)
  // döljs och får INTE påverka lägsta pris eller butiksantal (annars visar katalogen
  // ett lägre "pris" än produktsidan, t.ex. 69 kr vs 251 kr).
  const visible = p.offers.filter((o) => isDirectOfferUrl(o.url));
  const lowest = computeLowestPrice(visible);
  const change = computePriceChange7d(p.priceSnapshots);
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    category: p.category,
    imageUrl: p.imageUrl,
    language: p.language,
    setId: p.setId,
    setName: p.set?.name ?? null,
    setTotalCards: p.set?.totalCards ?? null,
    cardName: p.card?.name ?? null,
    cardNumber: p.card?.number ?? null,
    cardRarity: p.card?.rarity ?? null,
    variantLabel: p.variantLabel,
    lowestPrice: lowest.price,
    lowestPriceStockStatus: lowest.stockStatus,
    offerCount: visible.length,
    inStockCount: visible.filter((o) => o.stockStatus === "IN_STOCK").length,
    watchCount: p._count.watchlistItems,
    viewCount: p.viewCount,
    priceChange7d: change.change,
    priceChange7dPercent: change.percent,
    lastRestockAt: p.restockEvents[0]?.detectedAt ?? null,
  };
}

/**
 * Kategorier som tills vidare är gömda ur katalogen (filter + listning).
 * Användaren bad 2026-06-14 att ta bort dem för nu (kan återinföras senare).
 */
export const HIDDEN_CATEGORIES: ProductCategory[] = ["ACCESSORY", "GRADED_CARD", "OTHER"];

// Ägarens katalogborttagning bor i en leaf-modul (importcykel, se filens topp).
// Re-exporteras här så anropare bara behöver ETT ställe för synlighetsreglerna.
export { NOT_HIDDEN, NOT_HIDDEN_SQL } from "@/lib/product-visibility";

/** Språk katalogen visar. EN + JP är policyn; CN/KR/EU importeras inte och ska inte
 *  synas ens om något halkat in (isBlockedListingLanguage vaktar ingången). */
export const CATALOG_LANGUAGES: CardLanguage[] = ["EN", "JP"];

/**
 * Räknar om `Product.lowestPriceOre` = lägsta prissatta offer-pris (öre), null
 * om produkten saknar prissatt offer (→ gömd ur katalogen tills den får ett
 * pris igen). Körs efter scrape/refresh/import. Idempotent.
 */
export async function recomputeProductPriceCache(): Promise<void> {
  // En "räknbar" offer = prissatt (>0) OCH direkt produktlänk. URL-villkoret
  // speglar isDirectOfferUrl() så att cachen = produktsidans lägsta pris.
  // COALESCE(MIN i lager, MIN alla) = computeLowestPrice (IN_STOCK prioriteras).
  const DIRECT_PRICED = `price > 0 AND ${DIRECT_URL_SQL}`;
  await prisma.$executeRawUnsafe(`
    UPDATE "Product" p SET "lowestPriceOre" = sub.lowest
    FROM (
      SELECT "productId",
        COALESCE(MIN(price) FILTER (WHERE "stockStatus" = 'IN_STOCK'), MIN(price)) AS lowest
      FROM "Offer" WHERE ${DIRECT_PRICED} GROUP BY "productId"
    ) sub
    WHERE p.id = sub."productId" AND p."lowestPriceOre" IS DISTINCT FROM sub.lowest
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "Product" SET "lowestPriceOre" = NULL
    WHERE "lowestPriceOre" IS NOT NULL
      AND id NOT IN (SELECT "productId" FROM "Offer" WHERE ${DIRECT_PRICED})
  `);
}

/**
 * Skriver en daglig PriceSnapshot från det visade lägstapriset (`lowestPriceOre`)
 * för sealed-produkter som INTE redan fått en snapshot idag — dvs de som saknar
 * Cardmarket-trend (prissätts bara av svenska butiker, t.ex. league/GO-battle-decks).
 * Utan detta fryser deras historikgraf (cardmarket-refresh snapshottar bara CM-
 * mappade produkter). Priserna är ÄKTA observerade butikspriser → ingen fabrikation;
 * historiken byggs framåt. Kör SIST i den dagliga refreshen (efter CM-snapshots +
 * recompute) så CM-mappade produkter behåller sin trend och inget dubbelskrivs.
 * Returnerar antal skrivna snapshots.
 */
export async function snapshotStorePricedProducts(): Promise<number> {
  const today = utcToday();
  const haveToday = new Set(
    (await prisma.priceSnapshot.findMany({ where: { date: today }, select: { productId: true } }))
      .map((s) => s.productId)
  );
  const products = await prisma.product.findMany({
    where: {
      lowestPriceOre: { not: null },
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] },
    },
    select: { id: true, lowestPriceOre: true },
  });
  const data = products
    .filter((p) => !haveToday.has(p.id))
    .map((p) => ({
      productId: p.id,
      date: today,
      minPrice: p.lowestPriceOre!,
      maxPrice: p.lowestPriceOre!,
      avgPrice: p.lowestPriceOre!,
      volume: 1,
    }));
  if (data.length === 0) return 0;
  await prisma.priceSnapshot.createMany({ data, skipDuplicates: true });
  return data.length;
}

/**
 * Bygger Prisma-where ur sökparametrar (delas av katalog + utforska-feed).
 * Gömmer produkter UTAN prissatt offer (`lowestPriceOre = null`) — de dyker upp
 * automatiskt igen när de får ett pris (Cardmarket/Tradera).
 */
export async function buildProductWhere(
  params: Pick<
    SearchProductsParams,
    "query" | "category" | "setId" | "retailerId" | "stockStatus" | "language" | "sort"
  >
): Promise<Prisma.ProductWhereInput> {
  const { query, category, setId, retailerId, stockStatus, language } = params;
  const andClauses: Prisma.ProductWhereInput[] = [];

  if (query) {
    const words = normalizeTitle(query)
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean);
    const hasCompoundWords = words.some((w) => w.length >= 6);
    let compactMatchIds: string[] | null = null;
    if (hasCompoundWords) {
      const conditions = words.map((_, i) => `REPLACE(LOWER("normalizedTitle"), ' ', '') LIKE $${i + 1}`);
      const values = words.map((w) => `%${w.toLowerCase()}%`);
      // ⛔ Gömda måste bort HÄR också, inte bara i where-objektet nedan: id-listan
      //    går in i en OR-gren, och en gömd produkt som matchar kompaktsökningen
      //    hade då tagit sig förbi filtret via just den grenen.
      const sql = `SELECT "id" FROM "Product" WHERE ${conditions.join(" AND ")} AND ${NOT_HIDDEN_SQL} LIMIT ${MAX_CANDIDATES}`;
      const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...values);
      compactMatchIds = rows.map((r) => r.id);
    }
    const wordClauses: Prisma.ProductWhereInput[] = words.map((w) => ({
      normalizedTitle: { contains: w, mode: "insensitive" as const },
    }));
    if (compactMatchIds && compactMatchIds.length > 0) {
      andClauses.push({ OR: [{ AND: wordClauses }, { id: { in: compactMatchIds } }] });
    } else {
      andClauses.push(...wordClauses);
    }
  }

  // Setfiltret är EXAKT: produktens eget set, eller singelns korts set. Det fanns
  // förut en tredje reserv — "titeln innehåller setnamnet" — och den var ren
  // felträff. MÄTT mot hela prod-katalogen 2026-07-27: 2382 produkter drogs in i
  // fel set, och NOLL produkter utan eget set bidrog den med (dvs det den skulle
  // finnas till för hände aldrig). Setnamn är delsträngar av varandra och av
  // vanliga kortnamn: "Scarlet & Violet" fångade Destined Rivals-boostern och
  // hela Black Star Promos, "Dragon" varenda Dragonair, "Base" alla Secret Base-
  // kort, "151" varje kort med nummer 151 i vilket set som helst.
  // Återinför den ALDRIG utan ett facit som visar att den tillför något.
  if (setId) andClauses.push({ OR: [{ setId }, { card: { setId } }] });

  const where: Prisma.ProductWhereInput = andClauses.length > 0 ? { AND: andClauses } : {};
  // Ägarens borttagna produkter — se NOT_HIDDEN. Ligger på `where` och inte bland
  // andClauses för att gälla oavsett vilka grenar ovan som råkat vara aktiva.
  where.hiddenAt = null;
  // Flera valda kategorier = OR mellan dem. Gömda kategorier filtreras bort ur
  // valet först; blir listan tom faller vi tillbaka på "allt utom de gömda".
  const categories = toList(category).filter((c) => !HIDDEN_CATEGORIES.includes(c));
  if (categories.length > 0) where.category = { in: categories };
  else where.category = { notIn: HIDDEN_CATEGORIES };
  // Katalogen är EN + JP only. Utan detta var språk BARA ett användarfilter, så
  // default-vyn ("Alla språk") visade även OTHER-taggade produkter — de 6 spanska/
  // tyska Samlarhobby-boostrarna låg synliga i katalogen i fem dygn. Ett uttryckligt
  // filter respekteras, men "inget filter" betyder EN+JP, aldrig "allt".
  const languages = toList(language);
  if (languages.length > 0) where.language = { in: languages };
  else where.language = { in: CATALOG_LANGUAGES };
  const retailerIds = toList(retailerId);
  if (retailerIds.length > 0) {
    where.offers = {
      some: {
        retailerId: { in: retailerIds },
        stockStatus: "IN_STOCK",
        price: { not: null },
        NOT: { url: { contains: "search", mode: "insensitive" } },
      },
    };
  } else if (stockStatus) {
    where.offers = { some: { stockStatus } };
  }
  // Göm prislösa produkter — MED UNDANTAG FÖR TRYCKNINGAR (2026-07-28).
  //
  // Regeln finns för att hålla oprissatt skräp ute. En tryckning är inte skräp: den
  // är en kurerad katalogpost med en verifierad Cardmarket-länk, och att den saknar
  // pris betyder bara att CM just nu inte har en NM-engelsk annons för PRECIS den
  // tryckningen. Shadowless och 1st Edition delar CM-produkt, så de får medvetet
  // ingen uppskattning (den hade blivit identisk för båda) — utan undantaget nedan
  // vore de därför osynliga, och en sökning på "charizard base" hade visat en av tre
  // tryckningar i stället för alla tre. Priset visas som "–".
  //
  // ⛔ MEN UNDANTAGET GÄLLER INTE NÄR MAN SORTERAR PÅ PRIS (2026-08-13). Postgres
  // sorterar NULL FÖRST i DESC, så "Högsta pris" inleddes med de prislösa
  // tryckningarna — MÄTT i prod: 56 produkter (41 Shadowless + 15 1st Edition) av
  // 31 063, dvs hela första sidan visade "–" där det dyraste skulle stå. Att ordna
  // på ett värde produkten inte HAR är ingen fråga vi kan besvara, så
  // prissorteringarna kräver ett pris i stället för att stoppa in tryckningarna i
  // en godtycklig ände. Katalogens standardordning, sökningen och setvyn är orörda.
  // ⛔ Villkoret hör i where-byggaren, inte vid orderBy: `nulls: "last"` hade bara
  // flyttat dem till slutet av 31 007 produkter (alltså kvar i listan), och feedens
  // eget träffantal räknas på PRECIS det här villkoret — det ska säga 31 007.
  // ⚠️ Filter-sheetens knapp (`/api/products/count`) skickar INTE sorteringen och
  // räknar därför fortfarande med tryckningarna: den beskriver filterurvalet, och
  // att lägga sort i dess cache-nyckel hade multiplicerat antalet cache-poster med
  // antalet sorteringar för ett svar som skiljer 56 av 31 063.
  const requirePrice = PRICE_SORTS.has(normalizeSort(params.sort));
  andClauses.push(
    requirePrice
      ? { lowestPriceOre: { not: null } }
      : { OR: [{ lowestPriceOre: { not: null } }, { variantLabel: { in: [...PRINT_VARIANT_LABELS] } }] }
  );
  if (andClauses.length > 0) where.AND = andClauses;
  return where;
}

/** Sorteringar som ordnas direkt i DB → infinite scroll över HELA katalogen. */
const DB_SORTABLE = new Set<ProductSort>([
  "popular", "best_match", "price_asc", "price_desc", "most_watched",
  // A–Ö/Ö–A sorteras på normalizedTitle: den är gemener utan diakriter (a–z, 0–9)
  // och redan indexerad, så ordningen är densamma i C-collation som i en_US och
  // paginerar över HELA katalogen. Databasens collation är C.UTF-8 (mätt) → hade vi
  // sorterat på råa `title` hade versaler och "é" hamnat på egna platser.
  "title_asc", "title_desc",
  // Kortnummer MÅSTE vara DB-sorterat: den beräknade vägen sorterar bara de
  // MAX_CANDIDATES (500) senast uppdaterade produkterna, alltså ett godtyckligt
  // fönster — "sortera efter kortnummer" hade då hoppat över nummer beroende på
  // när raden råkade skrivas sist. Ordningen kommer ur Card.numberSortKey.
  "card_number_asc", "card_number_desc",
  // Nyligen tillagd MÅSTE vara DB-sorterad av samma skäl som kortnummer: den
  // beräknade vägen hämtar de 500 SENAST ÄNDRADE, och "senast ändrad" är inte
  // "senast skapad" — varje prisuppdatering rör updatedAt. Fönstret hade alltså
  // visat en godtycklig blandning och kallat den nyast.
  "recently_added",
]);

/**
 * "Trendar" = FART, inte volym: produkter med ovanligt mycket intresse just nu jämfört
 * med de föregående 7 dagarna (lift), INTE prisrörelse. "Mest populär" täcker ren volym.
 * Sorterar en redan hämtad kandidatlista efter lift. Produkter under golvet får lift 0 och
 * behåller sin sekundära ordning (stabil sort → populärast först), så listan aldrig blir
 * tom innan data hunnit byggas upp. Lift-listan är 1h-cachad (getTrendingLift) → billig.
 */
async function sortByTrending(items: ProductListItem[]): Promise<void> {
  const ranking = await getTrendingLift();
  const liftBySlug = new Map(ranking.map((r) => [r.productSlug, r.lift]));
  items.sort(
    (a, b) => (liftBySlug.get(b.slug) ?? 0) - (liftBySlug.get(a.slug) ?? 0)
  );
}

function feedOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case "best_match": return { rankScore: "desc" };
    case "title_asc": return { normalizedTitle: "asc" };
    case "title_desc": return { normalizedTitle: "desc" };
    case "price_asc": return { lowestPriceOre: "asc" };
    case "price_desc": return { lowestPriceOre: "desc" };
    case "most_watched": return { watchlistItems: { _count: "desc" } };
    // Sealed-produkter saknar kort → NULL. Postgres sorterar NULL sist i ASC och
    // först i DESC; vi vill ha dem SIST i båda (en låda har inget kortnummer och
    // ska inte inleda listan), därför explicit `nulls: "last"`.
    case "card_number_asc": return { card: { numberSortKey: { sort: "asc", nulls: "last" } } };
    case "card_number_desc": return { card: { numberSortKey: { sort: "desc", nulls: "last" } } };
    // ⛔ createdAt, ALDRIG updatedAt: den senare rörs av varje prisuppdatering, så
    //    "nyligen tillagd" hade blivit "nyligen prisändrad" — dvs hela katalogen i
    //    slumpmässig ordning. Kolumnen är oindexerad; sorteringen är admin-only och
    //    körs sällan, så en sortering av ~31k rader (tiotals ms) är billigare än en
    //    migration som måste köras för hand mot prod.
    case "recently_added": return { createdAt: "desc" };
    default: return { viewCount: "desc" };
  }
}

const FEED_INCLUDE = {
  // releaseDate används BARA av rankningen (färskhetsdelen i qualityScore) — den
  // mappas inte av toListItem och når alltså aldrig klientens payload.
  set: { select: { id: true, name: true, totalCards: true, releaseDate: true } },
  // card.setId: singelns set bor på KORTET, inte på produkten — utan det hade
  // set-släktskapet i personaliseringen missat varje singel.
  card: { select: { name: true, number: true, rarity: true, setId: true } },
  offers: { select: { price: true, stockStatus: true, url: true } },
  priceSnapshots: { where: { date: { gte: daysAgo(7) } }, select: { date: true, avgPrice: true } },
  restockEvents: { orderBy: { detectedAt: "desc" }, take: 1, select: { detectedAt: true } },
  _count: { select: { watchlistItems: true } },
} as const;

/**
 * buildProductWhere + prisfiltret (som ligger på den denormaliserade `lowestPriceOre`).
 * Delas av feeden och av antalsräkningen bakom filterknappen — visar de två olika
 * villkor säger knappen ett annat antal än feeden sedan levererar.
 */
async function whereForParams(
  params: SearchProductsParams,
  query = params.query
): Promise<Prisma.ProductWhereInput> {
  const w = await buildProductWhere({ ...params, query });
  const { minPrice, maxPrice } = params;
  if (minPrice !== undefined || maxPrice !== undefined) {
    w.lowestPriceOre = {
      not: null,
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    };
  }
  return w;
}

/** Rad ur feed-frågan — allt rankningen behöver finns här, inget extra anrop. */
type FeedRow = Prisma.ProductGetPayload<{ include: typeof FEED_INCLUDE }>;

/** Produktens egna kvalitetssignaler, som `qualityScore` väger ihop. */
function qualityInputOf(p: FeedRow): QualityInput {
  const offers = p.offers ?? [];
  return {
    engagement30d: p.viewCount,
    watchers: p._count.watchlistItems,
    // Samma vakt som resten av katalogen: en sök-/bläddringslänk är ingen vara i lager.
    inStockCount: offers.filter((o) => o.stockStatus === "IN_STOCK" && isDirectOfferUrl(o.url)).length,
    offerCount: offers.length,
    hasImage: !!p.imageUrl,
    hasPrice: p.lowestPriceOre != null,
    setReleaseDate: p.releaseDate ?? p.set?.releaseDate ?? null,
  };
}

/**
 * Sorterar en hämtad kandidatlista efter "bäst matchning". Poängen räknas på RÅ-raderna
 * (de bär kortnamn, kortnummer, setnamn och kvalitetssignalerna) och appliceras sedan på
 * de mappade objekten, så inget extra fält behöver skickas till klienten.
 */
function sortByBestMatch(
  items: ProductListItem[],
  rows: FeedRow[],
  opts: { query?: string; personal: PersonalContext }
): void {
  const score = new Map<string, number>();
  for (const p of rows) {
    score.set(
      p.id,
      bestMatchScore(
        {
          id: p.id,
          setId: p.setId ?? p.card?.setId ?? null,
          title: p.title,
          cardName: p.card?.name ?? null,
          cardNumber: p.card?.number ?? null,
          setName: p.set?.name ?? null,
          quality: qualityInputOf(p),
        },
        { query: opts.query, personal: opts.personal }
      )
    );
  }
  items.sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
}

/**
 * FUZZY-RESERV: bara när den exakta ordsökningen ger NOLL träffar. Trigram-likhet är
 * med flit INTE påslaget för lyckade sökningar — "charizard" hade då dragit in
 * "charmander" (likhet ~0,35) och grumlat en sökning som redan var rätt. Så här är den
 * ren räddning för felstavningar, och kostar en extra fråga bara när svaret ändå var tomt.
 */
async function fuzzyIds(query: string): Promise<string[]> {
  const q = normalizeTitle(query);
  if (q.length < 4) return [];
  try {
    // TVÅ MÅTT, för de missar OLIKA saker (mätt mot prod-katalogen 2026-07-29):
    //   similarity()      jämför HELA titeln → "prismatik" drunknar i en lång titel
    //                     ("Prismatic Evolutions Poster Collection") och gav 0 träffar.
    //   word_similarity() jämför frågan mot titelns bästa ORDFÖLJD → hittar den, men
    //                     missade "pikatchu" (0 träffar) som similarity klarade.
    // Unionen täcker båda. Precisionen får kosta här: den enda vägen hit är att den
    // exakta sökningen redan gav NOLL, och poängsättningen ordnar unionen efteråt.
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product"
      WHERE "hiddenAt" IS NULL
        AND (similarity("normalizedTitle", ${q}) > 0.28
         OR word_similarity(${q}, "normalizedTitle") > 0.6)
      ORDER BY GREATEST(
        similarity("normalizedTitle", ${q}),
        word_similarity(${q}, "normalizedTitle")
      ) DESC
      LIMIT ${MAX_CANDIDATES}`;
    return rows.map((r) => r.id);
  } catch {
    // pg_trgm saknas (dev-DB utan migrationen) → ingen reserv. Inte ett fel.
    return [];
  }
}

/**
 * Dina egna signaler. BARA det du själv lagt in: bevakningar, samling och de
 * favoritset du kryssade i vid registreringen. Ingen beteendelogg per användare
 * finns (analytics.ts strippar userId med flit) och ska inte byggas för det här —
 * söktermen påverkar ordningen via `relevanceScore` i stunden, men vilka ord DU
 * har sökt på lagras aldrig. Tre indexerade frågor på userId (User på PK).
 */
/**
 * ⛔ RETURNERAR ARRAYER, INTE SET. Den här funktionen ligger bakom `cachedRead`
 * (`unstable_cache`), och cachen SERIALISERAR returvärdet till JSON. Ett `Set`
 * överlever inte den resan: `JSON.stringify(new Set([1]))` är `{}`, så vid en
 * cache-TRÄFF hade `watchedProductIds` blivit ett tomt objekt och `.has(...)`
 * kastat "is not a function" — men bara efter första anropet, bara i produktion,
 * och bara för inloggade. Samma familj som Date→sträng-fällan i src/lib/cache.ts.
 * Set:en byggs därför av anroparen, utanför cachen.
 */
async function loadPersonalIdsRaw(
  userId: string
): Promise<{ watched: string[]; owned: string[]; affinity: string[] }> {
  const ctx = await loadPersonalContextUncached(userId);
  return {
    watched: [...ctx.watchedProductIds],
    owned: [...ctx.ownedProductIds],
    affinity: [...ctx.affinitySetIds],
  };
}

/**
 * Dina egna signaler, cachade `PERSONAL_TTL_SECONDS` per userId. Bevakningar och
 * samling ändras av användaren själv och läses på VARJE feed-anrop — under en
 * oändlig scroll blev det två indexerade frågor per sida, alla med samma svar.
 */
async function loadPersonalContext(userId?: string): Promise<PersonalContext | null> {
  if (!userId) return null;
  const ids = await cachedPersonalIds(userId);
  return {
    watchedProductIds: new Set(ids.watched),
    ownedProductIds: new Set(ids.owned),
    affinitySetIds: new Set(ids.affinity),
  };
}

async function loadPersonalContextUncached(userId: string): Promise<PersonalContext> {
  const [watched, owned, prefs] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      select: { productId: true, product: { select: { setId: true, card: { select: { setId: true } } } } },
    }),
    prisma.collectionItem.findMany({
      where: { userId },
      select: {
        productId: true,
        product: { select: { setId: true, card: { select: { setId: true } } } },
        card: { select: { setId: true } },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }),
  ]);
  const affinitySetIds = new Set<string>();
  const add = (id?: string | null) => { if (id) affinitySetIds.add(id); };
  for (const w of watched) { add(w.product?.setId); add(w.product?.card?.setId); }
  for (const c of owned) { add(c.product?.setId); add(c.product?.card?.setId); add(c.card?.setId); }
  // Onboardingens favoritset ADDERAS till samma affinitet som bevakningar och
  // samling redan bygger — de är samma sorts påstående ("de här seten bryr jag
  // mig om"), bara insamlat vid ett annat tillfälle. En EGEN vikt hade krävt en
  // kalibrering vi inte har underlag för (mätt 2026-07-29: 4 användare, 8
  // sökklick — det räcker inte till att skilja två vikter åt), och ett kryss vid
  // registreringen säger inte mer eller mindre än en bevakning.
  //
  // ⛔ Signalen var HELT OANVÄND fram till 2026-08-06: `favoriteSets` skrevs av
  // /api/users/me/onboarding och lästes ingenstans. Steget bad om något vi sedan
  // kastade.
  for (const id of favoriteSetIds(prefs?.preferences)) add(id);
  return {
    watchedProductIds: new Set(watched.map((w) => w.productId)),
    ownedProductIds: new Set(owned.map((c) => c.productId).filter((id): id is string => !!id)),
    affinitySetIds,
  };
}

/**
 * Utforska-feed med offset-paginering (infinite scroll). DB-sorterbara
 * sorteringar paginerar över HELA katalogen; beräknade sorteringar (prisfall/
 * trend/restock/sökt "bäst matchning") körs över topp-MAX_CANDIDATES (scrollen
 * stannar där).
 */
async function getExploreFeedRaw(
  params: SearchProductsParams,
  offset: number,
  limit: number
): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const sort = normalizeSort(params.sort);
  const { minPrice, maxPrice } = params;
  if (sort === "deals") return getDealsRaw(offset, limit);

  const buildWhere = (query?: string) => whereForParams(params, query);

  let where = await buildWhere(params.query);
  // Räknas här bara om vi ändå måste veta om sökningen gav noll (fuzzy-reserven);
  // värdet återanvänds nedan så samma count aldrig körs två gånger.
  let known: number | null = null;
  if (params.query) {
    known = await prisma.product.count({ where });
    if (known === 0) {
      const ids = await fuzzyIds(params.query);
      if (ids.length > 0) {
        where = { AND: [await buildWhere(undefined), { id: { in: ids } }] };
        known = null; // nytt villkor → gamla antalet gäller inte
      }
    }
  }

  const personal = await loadPersonalContext(params.userId);
  // "Bäst matchning" är ren SQL (rankScore) så länge ordningen är densamma för alla —
  // då paginerar den över HELA katalogen. Poängsättning i minnet krävs så fort
  // RELEVANS (sökord) eller ett PERSONLIGT lyft ska väga in, och den vägen ser bara
  // de MAX_CANDIDATES främsta.
  //
  // ⛔ DÄRFÖR PERSONALISERAS INTE EN OFILTRERAD KATALOG: gjorde den det stannade
  // "22 233 produkter" på 500 för varje inloggad besökare, och den oändliga scrollen
  // med den. Ett litet lyft är inte värt en katalog som tar slut. Ryms hela
  // träffmängden i fönstret (ett valt set, en kategori, en sökning) är det ofarligt.
  const needsCount = sort === "best_match" || DB_SORTABLE.has(sort);
  const total = known ?? (needsCount ? await prisma.product.count({ where }) : 0);
  const scored =
    sort === "best_match" &&
    (!!params.query || (personal !== null && total <= MAX_CANDIDATES));

  if (DB_SORTABLE.has(sort) && !scored) {
    const products = await prisma.product.findMany({
      where,
      include: FEED_INCLUDE,
      orderBy: [feedOrderBy(sort), { id: "asc" }],
      skip: offset,
      take: limit,
    });
    const items = products.map(toListItem);
    return { items, total, hasMore: offset + items.length < total };
  }

  // Beräknade sorteringar: topp-N-kandidater, sortera i minnet, skiva.
  // Kandidaturvalet för "bäst matchning" tas i KVALITETSordning, inte "senast ändrad":
  // blir träffmängden större än fönstret ska det som klipps bort vara det svagaste,
  // inte det som råkade skrivas längst tillbaka.
  const products = await prisma.product.findMany({
    where,
    include: FEED_INCLUDE,
    take: MAX_CANDIDATES,
    orderBy: sort === "best_match" ? { rankScore: "desc" } : { updatedAt: "desc" },
  });
  const items = products.map(toListItem);
  if (sort === "best_match") sortByBestMatch(items, products, { query: params.query, personal: personal ?? EMPTY_PERSONAL });
  else if (sort === "biggest_drop") items.sort((a, b) => (a.priceChange7dPercent ?? 0) - (b.priceChange7dPercent ?? 0));
  else if (sort === "trending") await sortByTrending(items);
  else if (sort === "recently_restocked") items.sort((a, b) => (b.lastRestockAt?.getTime() ?? 0) - (a.lastRestockAt?.getTime() ?? 0));
  // Fönstret ÄR listan här: scrollen stannar vid MAX_CANDIDATES.
  const windowTotal = Math.min(items.length, MAX_CANDIDATES);
  return {
    items: items.slice(offset, offset + limit),
    total: windowTotal,
    hasMore: offset + limit < windowTotal,
  };
}

// Gemensamt villkor: en Tradera-offer (alias o, produkt p, cm-CTE) i fynd-bandet mot
// Cardmarket, bara sealed, direkt annons-URL. Params: $1=cmId $2=traderaId $3=min $4=max.
const CM_MIN_CTE = `WITH cm AS (
  SELECT "productId", MIN(price) AS price FROM "Offer"
  WHERE "retailerId" = $1 AND price > 0 GROUP BY "productId"
)`;
const DEAL_OFFER_WHERE = `o."retailerId" = $2 AND o."stockStatus" = 'IN_STOCK' AND o.price > 0
  AND ${DIRECT_URL_SQL}
  AND p.category NOT IN ('SINGLE_CARD', 'GRADED_CARD', 'ACCESSORY', 'OTHER')
  AND o.price <= cm.price * (1 - $3)
  AND o.price >= cm.price * (1 - $4)`;

export interface DealCandidate {
  offerId: string;
  productId: string;
  traderaUrl: string;
  traderaPrice: number;
  cmPrice: number;
  title: string;
  category: string;
}

/**
 * Fynd-KANDIDATER (per Tradera-offer, ej verifierade) — indata till verify-deals-jobbet.
 * Referens = billigaste CM-offer (ALDRIG Product.lowestPriceOre — den inkluderar redan
 * Tradera-annonsen). Bara sealed (singlar har skick-brus). Liten mängd.
 */
export async function dealCandidateOffers(): Promise<DealCandidate[]> {
  const [cm, tr] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
    prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
  ]);
  if (!cm || !tr) return [];
  return prisma.$queryRawUnsafe<DealCandidate[]>(
    `${CM_MIN_CTE}
    SELECT o.id AS "offerId", o."productId" AS "productId", o.url AS "traderaUrl",
           o.price AS "traderaPrice", cm.price AS "cmPrice",
           p.title AS title, p.category::text AS category
    FROM "Offer" o
      JOIN cm ON cm."productId" = o."productId"
      JOIN "Product" p ON p.id = o."productId"
    WHERE ${DEAL_OFFER_WHERE}`,
    cm.id,
    tr.id,
    DEAL_MIN_DISCOUNT,
    DEAL_MAX_DISCOUNT
  );
}

/**
 * Fynd-feed (Pro): produkter med en LLM-VERIFIERAD Tradera-annons långt under sitt
 * Cardmarket-pris. Bara annonser vars DealCheck.ok=true, vars pris inte ändrats sedan
 * verifieringen, och som inte löpt ut. Väljer billigaste verifierade annons per produkt,
 * sorterat på störst rabatt.
 * ponytail: hämtar alla kvalade rader (3 fält) per sida — fynd är en liten mängd.
 */
async function getDealsRaw(
  offset: number,
  limit: number
): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const [cm, tr] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
    prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
  ]);
  if (!cm || !tr) return { items: [], total: 0, hasMore: false };

  const rows = await prisma.$queryRawUnsafe<
    { productId: string; discount: number; listingTitle: string | null }[]
  >(
    `${CM_MIN_CTE}
    SELECT d."productId", d.discount, d."listingTitle"
    FROM (
      SELECT DISTINCT ON (o."productId")
             o."productId" AS "productId",
             (cm.price - o.price)::float / cm.price AS discount,
             dc."listingTitle" AS "listingTitle"
      FROM "Offer" o
        JOIN cm ON cm."productId" = o."productId"
        JOIN "Product" p ON p.id = o."productId"
        JOIN "DealCheck" dc ON dc."offerId" = o.id
      WHERE ${DEAL_OFFER_WHERE}
        AND dc.ok = true
        AND dc."checkedPrice" = o.price
        AND (dc."endsAt" IS NULL OR dc."endsAt" > now())
      ORDER BY o."productId", o.price ASC
    ) d
    ORDER BY d.discount DESC`,
    cm.id,
    tr.id,
    DEAL_MIN_DISCOUNT,
    DEAL_MAX_DISCOUNT
  );

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);
  const products = await prisma.product.findMany({
    where: { id: { in: pageRows.map((r) => r.productId) } },
    include: FEED_INCLUDE,
  });
  const byId = new Map(products.map((p) => [p.id, toListItem(p)]));
  const items: ProductListItem[] = [];
  for (const r of pageRows) {
    const item = byId.get(r.productId);
    if (item)
      items.push({ ...item, dealPercent: Math.round(r.discount * 100), dealListingTitle: r.listingTitle });
  }
  return { items, total, hasMore: offset + pageRows.length < total };
}

async function searchProductsRaw(params: SearchProductsParams): Promise<{
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { minPrice, maxPrice, page, pageSize } = params;
  const sort = normalizeSort(params.sort);

  // Filter (inkl. gömning av prislösa produkter) byggs av den delade
  // buildProductWhere — samma logik som utforska-feeden.
  let where = await buildProductWhere(params);
  if (params.query && (await prisma.product.count({ where })) === 0) {
    const ids = await fuzzyIds(params.query);
    if (ids.length > 0) {
      where = { AND: [await buildProductWhere({ ...params, query: undefined }), { id: { in: ids } }] };
    }
  }
  const personal = await loadPersonalContext(params.userId);

  const products = await prisma.product.findMany({
    where,
    include: FEED_INCLUDE,
    take: MAX_CANDIDATES,
    orderBy: sort === "best_match" ? { rankScore: "desc" } : { updatedAt: "desc" },
  });

  let items = products.map(toListItem);

  // Prisfilter appliceras på lägsta pris
  if (minPrice !== undefined) {
    items = items.filter((i) => i.lowestPrice !== null && i.lowestPrice >= minPrice);
  }
  if (maxPrice !== undefined) {
    items = items.filter((i) => i.lowestPrice !== null && i.lowestPrice <= maxPrice);
  }

  /** Sealed saknar kortnummer → alltid sist, oavsett riktning. */
  const byCardNumber = (a: ProductListItem, b: ProductListItem, dir: 1 | -1) => {
    if (!a.cardNumber && !b.cardNumber) return 0;
    if (!a.cardNumber) return 1;
    if (!b.cardNumber) return -1;
    return compareCardNumbers(a.cardNumber, b.cardNumber) * dir;
  };

  /** A–Ö/Ö–A på samma nyckel som DB-vägen (normalizedTitle, kodpunktsordning). */
  const byTitle = (a: ProductListItem, b: ProductListItem, dir: 1 | -1) => {
    const x = normalizeTitle(a.title);
    const y = normalizeTitle(b.title);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  };

  const byPrice = (a: ProductListItem, b: ProductListItem, dir: 1 | -1) => {
    if (a.lowestPrice === null && b.lowestPrice === null) return 0;
    if (a.lowestPrice === null) return 1;
    if (b.lowestPrice === null) return -1;
    return (a.lowestPrice - b.lowestPrice) * dir;
  };

  switch (sort) {
    case "price_asc":
      items.sort((a, b) => byPrice(a, b, 1));
      break;
    case "price_desc":
      items.sort((a, b) => byPrice(a, b, -1));
      break;
    case "biggest_drop":
      items.sort(
        (a, b) => (a.priceChange7dPercent ?? 0) - (b.priceChange7dPercent ?? 0)
      );
      break;
    case "trending":
      await sortByTrending(items);
      break;
    case "most_watched":
      items.sort((a, b) => b.watchCount - a.watchCount);
      break;
    case "recently_restocked":
      items.sort(
        (a, b) =>
          (b.lastRestockAt?.getTime() ?? 0) - (a.lastRestockAt?.getTime() ?? 0)
      );
      break;
    // Samma ordning som DB-vägen (Card.numberSortKey) — här på det redan hämtade
    // urvalet. Produkter utan kortnummer (sealed) hamnar sist i BÅDA riktningarna.
    case "card_number_asc":
    case "card_number_desc":
      items.sort((a, b) => byCardNumber(a, b, sort === "card_number_asc" ? 1 : -1));
      break;
    // Samma ordning som DB-vägen: jämförelsen görs på normalizedTitle (gemener,
    // utan diakriter) och med rak kodpunktsjämförelse — localeCompare hade gett en
    // ANNAN ordning än databasens C-collation.
    case "title_asc":
    case "title_desc":
      items.sort((a, b) => byTitle(a, b, sort === "title_asc" ? 1 : -1));
      break;
    case "best_match":
    default:
      sortByBestMatch(items, products, {
        query: params.query,
        personal: personal ?? EMPTY_PERSONAL,
      });
      break;
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

async function getProductBySlugRaw(slug: string) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      set: true,
      card: true,
      offers: {
        include: { retailer: { select: { id: true, name: true, logoUrl: true, websiteUrl: true } } },
        orderBy: { price: { sort: "asc", nulls: "last" } },
      },
      // Restock-historiken hämtas INTE här: den är admin-only (se restock-history.tsx)
      // och sidan är ISR-cachad — datat skulle ligga i payloaden för alla besökare
      // och kosta en Neon-fråga per rendering av 20k produktsidor.
      priceSnapshots: {
        where: { date: { gte: daysAgo(7) } },
        select: { date: true, avgPrice: true },
      },
      _count: { select: { watchlistItems: true } },
    },
  });
  if (!product) throw new ServiceError(404, "Produkten hittades inte.");

  const lowest = computeLowestPrice(
    product.offers
      .filter((o) => isDirectOfferUrl(o.url))
      .map((o) => ({ price: o.price, stockStatus: o.stockStatus }))
  );
  const change = computePriceChange7d(product.priceSnapshots);

  const { priceSnapshots: _snapshots, _count, ...rest } = product;
  return {
    ...rest,
    watchCount: _count.watchlistItems,
    lowestPrice: lowest.price,
    lowestPriceStockStatus: lowest.stockStatus,
    priceChange7d: change.change,
    priceChange7dPercent: change.percent,
  };
}

/** Prishistorik (dagliga snapshots) för grafer. */
async function getPriceHistoryRaw(productId: string, days: number) {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { productId, date: { gte: daysAgo(days) } },
    orderBy: { date: "asc" },
    select: { date: true, minPrice: true, maxPrice: true, avgPrice: true, volume: true },
  });
  return snapshots;
}

/** Källor vars observationer utgör marknadspriset (Cardmarket-data). */
export const CARDMARKET_SOURCE_NAMES = ["Cardmarket", "Pokémon TCG API", "TCGdex API"];

/**
 * CardTraders marknadsplats — EGEN serie, aldrig hopblandad med Cardmarket.
 * Namnet är samma sträng som `ScrapeSource.name` och som retailern, av samma skäl
 * som `CT_REVERSE_LABEL` bor på ett ställe: en källa som stavas på två ställen
 * stavas förr eller senare olika, och då försvinner serien tyst.
 */
export const CARDTRADER_SOURCE_NAME = "CardTrader";

/**
 * Tradera SÅLT — genomförda auktioner, en EGEN serie.
 *
 * ⛔ MÅSTE vara ett annat `ScrapeSource.name` än "Tradera". Delade de namn hamnade
 * hammarpriser i annonskurvan, och den kurvan skulle då ibland betyda "betalat"
 * och ibland "begärt" — exakt den skarv som gjorde CM-grafen obegriplig i juli.
 */
export const TRADERA_SOLD_SOURCE_NAME = "Tradera sålt";

/**
 * Så många dygn får `fillForward` överbrygga. SAMMA tal som hjärtslaget i
 * `cardtrader-observation.ts` (`CT_MAX_GAP_DAYS`) — se motiveringen där. Glider de
 * isär börjar grafen dikta över driftstopp.
 */
export const CT_MAX_GAP_DAYS = 7;

const DAY_MS = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Fyller i dagar mellan punkter med senast KÄNDA pris — men bara korta luckor.
 *
 * ⛔ BARA FÖR KÄLLOR SOM SKRIVS VID ÄNDRING. CardTrader hoppar över ett skriv när
 * priset stått stilla, så en lucka där betyder "vi kollade, inget hände" och det
 * är rimligt att rita den platt. För Cardmarket betyder en lucka något helt annat:
 * MÄTT 2026-08-03 har bara 4,1 % av produkterna en HÅLFRI CM-serie (dygnstäckning
 * 95,1 %), och den 2026-07-24 skrevs bara 2 893 rader mot normala ~20 500 — ett
 * avbrutet jobb. Att fylla den luckan hade påstått ett pris för ~17 600 produkter
 * en dag vi aldrig tittade. Tradera/butiker är samma sak av en tredje anledning:
 * en dag utan annons betyder att ingen SÅLDE kortet, inte att priset låg kvar.
 *
 * ⛔ LÅNGA LUCKOR LÄMNAS ÖPPNA. Hjärtslaget garanterar en punkt var
 * `CT_MAX_GAP_DAYS` dygn, så en lucka som är längre ÄR ett avbrott — och då är
 * ärligast att inte rita något alls.
 */
export function fillForward(
  series: SourceHistoryPoint[],
  now: Date = new Date(),
  maxGapDays = CT_MAX_GAP_DAYS
): SourceHistoryPoint[] {
  if (series.length === 0) return series;
  const out: SourceHistoryPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const point = series[i];
    out.push(point);
    // Slutet på serien räknas mot IDAG: priset gäller tills något annat sagts,
    // men inte längre än hjärtslaget kan ha varit tyst.
    const nextTime = i + 1 < series.length
      ? Date.parse(`${series[i + 1].date}T00:00:00Z`)
      : Date.parse(`${dayKey(now.getTime())}T00:00:00Z`) + DAY_MS;
    const from = Date.parse(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(nextTime) || !Number.isFinite(from)) continue;
    const gapDays = Math.round((nextTime - from) / DAY_MS);
    if (gapDays <= 1 || gapDays > maxGapDays) continue;
    for (let d = 1; d < gapDays; d++) out.push({ date: dayKey(from + d * DAY_MS), price: point.price });
  }
  return out;
}

/** Så många dagar får CM-trenden släpa efter butikernas färskaste punkt innan den
 *  räknas som död och grafen faller tillbaka på butikstrenden (CM-refresh kör dagligen
 *  → några dagars nåd tål ett hoppat jobb utan att friska produkter flippar källa). */
const TREND_STALE_DAYS = 3;

/** Marknadsplatser/priskällor — INTE butiker. Restock-larm ska aldrig avse dessa. */
export const NON_RETAIL_SOURCE_NAMES = [...CARDMARKET_SOURCE_NAMES, "Tradera"];

/**
 * "Återförsäljare" som egentligen är pris-DATAKÄLLOR (inte köpbara butiker) eller
 * mock — ska ALDRIG visas i butiksfiltret eller som köpbara offers. Cardmarket och
 * Tradera är riktiga marknadsplatser och behålls.
 */
export const NON_STORE_RETAILER_NAMES = [
  "Pokémon TCG API",
  "TCGdex API",
  "Mock-datakälla",
];

export interface SourceHistoryPoint {
  date: string; // YYYY-MM-DD
  price: number; // öre, dagligt snitt
}

export interface PriceHistoryBySource {
  cardmarket: SourceHistoryPoint[];
  cardtrader: SourceHistoryPoint[];
  tradera: SourceHistoryPoint[];
  /** Genomförda Tradera-auktioner — BETALT, inte begärt. Se bucketet nedan. */
  traderaSold: SourceHistoryPoint[];
  butiker: SourceHistoryPoint[];
}

/**
 * Serier grafen ritar, i den ordning färgerna tilldelas.
 *
 * ⛔ BUTIKER ÄR INTE EN MARKNAD (ägarbeslut 2026-08-03). Butikerna är LÄNKAR — vi
 * skickar besökaren dit för att köpa, och deras pris hör hemma i pristabellen där
 * varje butik står namngiven med sitt eget pris. Som KURVA blev det däremot en
 * anonym linje som blandade ihop åtta olika butikers sortiment. Observationerna
 * skrivs fortfarande (de driver pristabellen och `computeChanges`); det är bara
 * grafen de inte hör hemma i. MÄTT före borttagningen: exakt **18 av 31 053**
 * produkter med prishistorik hade butiker som ENDA källa och tappar sin kurva.
 */
export const HISTORY_SOURCE_KEYS = [
  "cardmarket",
  "cardtrader",
  "tradera",
  "traderaSold",
] as const;
export type HistorySourceKey = (typeof HISTORY_SOURCE_KEYS)[number];

/** Rå prisobservation för käll-/dagsbucketing (utbruten för testbarhet). */
export interface RawSourceObservation {
  price: number;
  observedAt: Date;
  source: { name: string | null } | null;
}

/**
 * Bucketar observationer till en serie per källa och dag.
 *
 * CARDMARKET-serien = SISTA observationen per dag, ALDRIG dagsmedel. Samma dag kan
 * få flera CM-skrivningar som alla beskriver SAMMA storhet men vid olika tidpunkt/
 * kvalitet: morgonens trend-obs (scrape-all), en avbruten refresh, en omkörd körning
 * som HEALAT ett tidigare fruset pris. Ett medel av dem är en siffra som aldrig
 * funnits på marknaden — mätt 2026-07-23: Rayquaza ★ Deoxys visade 175 439 kr
 * = medel av det spärrhake-frusna 281 265 och det healade 69 613. Senaste
 * skrivningen är dagens bästa svar; äldre samma-dag-skrivningar är ersatta.
 *
 * ── ALLA SERIER MÄTER SAMMA STORHET: DAGENS LÄGSTA (2026-08-03) ─────────────
 * Tradera och butiker bucketades förut som DAGSMEDEL, med motiveringen att flera
 * observationer samma dag är olika annonser och att snittet "är just det vi vill
 * visa". Det höll så länge grafen ritade EN serie i taget. Nu kan användaren lägga
 * serierna ovanpå varandra, och då blir medelvärdet direkt vilseledande: Cardmarket
 * ritar sitt NM-engelska GOLV och CardTrader sitt billigaste NM-engelska annonspris,
 * så en Tradera-linje som är ett SNITT hade legat systematiskt högre utan att
 * marknaden var dyrare. Det är samma fel som skarven mellan trend och golv (se
 * ovan), fast mellan två kurvor i stället för i en.
 *
 * Dagens lägsta är dessutom det tal pristabellen redan visar ("Lägsta pris ·
 * Tradera"), så linjen och rubriken beskriver äntligen samma sak.
 *
 * ⛔ HISTORIKEN SKRIVS INTE OM — den RÄKNAS OM. Varje enskild observation ligger
 * kvar i `PriceObservation`; det är bara aggregeringen som ändras, så hela den
 * gamla serien får sin nya form retroaktivt och konsekvent.
 *
 * ── EN SERIE = EN STORHET (2026-07-27) ──────────────────────────────────────
 * Serien blandade två OLIKA mätvärden och ritade dem som en kurva. Fram till
 * 2026-06-13 skrev scrape-jobbet pokemontcg.io:s CM-TREND (källa "Pokémon TCG API");
 * från 2026-06-19 skriver cardmarket-refresh CM:s NM-ENGELSKA GOLV (källa
 * "Cardmarket"). Det är inte samma storhet, och skarven blev ett fritt fall eller ett
 * skyhopp som aldrig hänt på marknaden — mätt: 19 679 av 20 514 singlar har båda
 * källorna i sin "Cardmarket"-serie, och de värsta skarvarna är 1 531 kr → 0,33 kr.
 * Det var en STOR del av "priset ändras från ingenstans".
 *
 * Regeln: finns ÄKTA Cardmarket-observationer för produkten är de enda som får bilda
 * serien; trend-källorna hoppas över (de ligger kvar i DB, men de hör inte i samma
 * kurva). Saknas de helt är trend-serien allt vi har och används som förut — det
 * gäller 14 singlar och noll sealed, så inga grafer töms av det här.
 */
export function bucketObservationsBySource(
  observations: RawSourceObservation[]
): PriceHistoryBySource {
  const ordered = [...observations].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );

  // Cardmarket och CardTrader publicerar ETT tal per körning (ett golv), så där är
  // dagens sista skrivning dagens bästa svar. Tradera/butiker har flera OLIKA
  // annonser per dag och bucketas till dagens LÄGSTA — se resonemanget ovan.
  const cardmarket = new Map<string, number>();
  const cardtrader = new Map<string, number>();
  const lowest = {
    tradera: new Map<string, number>(),
    butiker: new Map<string, number>(),
  };
  // ⛔ SÅLT BUCKETAS SOM MEDIAN, INTE SOM DAGENS LÄGSTA — och det är ingen glidning
  // från regeln ovan, det är samma regel tillämpad på en annan storhet. "Dagens
  // lägsta" är rätt för ANNONSER därför att alla annonser samma dag beskriver samma
  // sak (vad varan kostar nu) och den billigaste är det svaret. Flera FÖRSÄLJNINGAR
  // samma dag är däremot olika affärer, alla lika sanna; att plocka den billigaste
  // hade ritat "vad det gick att fynda för", inte "vad varan såldes för". Medianen
  // tål dessutom den udda auktionen som gick för en krona utan att kastas bort.
  // Med 1–2 affärer per dygn (mätt) är medianen i praktiken affären själv.
  const soldByDay = new Map<string, number[]>();
  const hasTrueCardmarket = ordered.some((o) => o.source?.name === "Cardmarket");

  for (const o of ordered) {
    const name = o.source?.name ?? null;
    const day = o.observedAt.toISOString().slice(0, 10);
    if (name === TRADERA_SOLD_SOURCE_NAME) {
      const bucket = soldByDay.get(day);
      if (bucket) bucket.push(o.price);
      else soldByDay.set(day, [o.price]);
      continue;
    }
    if (name === CARDTRADER_SOURCE_NAME) {
      cardtrader.set(day, o.price); // stigande tidsordning → sista vinner
      continue;
    }
    if (name && CARDMARKET_SOURCE_NAMES.includes(name)) {
      // Legacy trend-punkt bredvid äkta CM-golv → annan storhet, hör inte i kurvan.
      if (hasTrueCardmarket && name !== "Cardmarket") continue;
      cardmarket.set(day, o.price);
      continue;
    }
    const group = name === "Tradera" ? "tradera" : "butiker";
    const prev = lowest[group].get(day);
    if (prev == null || o.price < prev) lowest[group].set(day, o.price);
  }

  const toSeries = (m: Map<string, number>): SourceHistoryPoint[] =>
    [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, price]) => ({ date, price }));

  const soldSeries: SourceHistoryPoint[] = [...soldByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, prices]) => ({ date, price: medianOre(prices) }));

  return {
    cardmarket: toSeries(cardmarket),
    // Enda serien som fylls i — den är också den enda som skrivs VID ÄNDRING.
    cardtrader: fillForward(toSeries(cardtrader)),
    tradera: toSeries(lowest.tradera),
    // ⛔ INGEN fillForward här: en försäljning är en HÄNDELSE, inte ett tillstånd.
    // Att dra ut den till nästa punkt hade påstått att varan såldes för samma
    // belopp varje dag däremellan. Glesa punkter är det ärliga utseendet.
    traderaSold: soldSeries,
    butiker: toSeries(lowest.butiker),
  };
}

/** Median i öre (jämnt antal → medelvärdet av de två mittersta, avrundat). */
export function medianOre(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Prishistorik per källa (per dag, av riktiga prisobservationer):
 * - cardmarket: Cardmarket-priser (senaste per dag — se bucketObservationsBySource)
 * - tradera: skrapade Tradera-listningar (dagligt snitt)
 * - butiker: svenska butiksskrapare (dagligt snitt)
 */
async function getPriceHistoryBySourceRaw(
  productId: string,
  days: number
): Promise<PriceHistoryBySource> {
  const observations = await prisma.priceObservation.findMany({
    where: { productId, observedAt: { gte: daysAgo(days) } },
    orderBy: { observedAt: "asc" },
    select: { price: true, observedAt: true, source: { select: { name: true } } },
  });
  return bucketObservationsBySource(observations);
}

/**
 * Hela produktsidans data i ETT serialiserbart paket — delas av SSR-sidan
 * (`/produkter/[slug]`) och produkt-overlayn (`/api/products/[slug]/detail`).
 * Datum är ISO-strängar (tål både Date och cache-serialiserad sträng).
 */
export interface ProductDetailData {
  id: string;
  slug: string;
  title: string;
  category: ProductCategory;
  language: CardLanguage;
  description: string | null;
  imageUrl: string | null;
  watchCount: number;
  updatedAt: string;
  set: { id: string; name: string } | null;
  /** Cardmarket-trendserie (hela perioden; klienten filtrerar). */
  chartData: SourceHistoryPoint[];
  /** Serierna grafen får rita (utan butiker — se HISTORY_SOURCE_KEYS). Ingen extra
   *  DB-kostnad: `getPriceHistoryBySource` räknade redan ut allihop. */
  historyBySource: Pick<PriceHistoryBySource, (typeof HISTORY_SOURCE_KEYS)[number]>;
  /** Källa för historik-grafen → graf-rubrik (CM-trend vs butiks-snitt vs Tradera). */
  trendSource: "cardmarket" | "cardtrader" | "tradera";
  change7: number | null;
  change30: number | null;
  offerCount: number;
  stats: LiveOfferStats;
  serializedOffers: SerializedOffer[];
  affiliateRetailerIds: string[];
  similar: {
    id: string;
    slug: string;
    title: string;
    imageUrl: string | null;
    category: ProductCategory;
    setId: string | null;
    setName: string | null;
    setTotalCards: number | null;
    cardName: string | null;
    cardNumber: string | null;
    cardRarity: string | null;
    variantLabel: string | null;
    lowestPrice: number | null;
    lowestPriceStockStatus: StockStatus | null;
  }[];
  /** Andra Cardmarket-versioner av samma kort (common ↔ special-variant). */
  variants: {
    slug: string;
    /** `null` = den etikettlösa (vanliga) versionen; klienten översätter ordet. */
    label: string | null;
    lowestPrice: number | null;
  }[];
  /**
   * Levande Tradera-annonser för SAMMA produkt ("Fler annonser på Tradera",
   * #19) — fylls av tradera-sweep Fas 0, billigast först. Bara rader färska nog
   * att annonsen sannolikt lever; tom lista → sektionen visas inte.
   */
  traderaListings: {
    itemId: string;
    title: string;
    price: number;
    url: string;
    imageUrl: string | null;
  }[];
}

interface LiveOfferStats {
  lowestPrice: number | null;
  lowestPriceStockStatus: StockStatus | null;
  highestPrice: number | null;
  avgPrice: number | null;
  offerCount: number;
}

interface SerializedOffer {
  id: string;
  price: number | null;
  shippingPrice: number | null;
  stockStatus: StockStatus;
  url: string;
  retailerId: string;
  retailer: {
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string;
    affiliateEnabled: boolean;
  };
}

const DETAIL_MAX_DAYS = 3650; // ~10 år = "hela serien" (klienten filtrerar period)

// Tradera-annonser äldre än så visas inte (annonsen kan ha sålts sedan svepet;
// populära produkter uppdateras dagligen, långsvansen var ~4:e dag).
const TRADERA_LISTING_MAX_AGE_DAYS = 4;

/** Är felet "produkten finns inte" (ServiceError 404) — till skillnad från ett DB-/anslutningsfel? */
function isNotFoundError(err: unknown): boolean {
  if (err instanceof ServiceError) return err.status === 404;
  return (err as { name?: string; status?: number } | null)?.name === "ServiceError" &&
    (err as { status?: number }).status === 404;
}

async function loadProductDetailRaw(slug: string): Promise<ProductDetailData | null> {
  // BARA ett äkta "produkten finns inte" får bli null. Den gamla blanka
  // `.catch(() => null)` svalde ÄVEN anslutningsfel (P1017 när Neon vaknar ur
  // scale-to-zero) → sidan kallade notFound() → ISR CACHADE 404:an i en timme.
  // Symtomet: en produkt man precis öppnat "försvinner" ur katalogen ett tag och
  // kommer sedan tillbaka av sig själv. Ett DB-fel måste kastas vidare (fel-sida,
  // inget cachat 404) och först retry:as mot uppvaknandet.
  const product = await withDbRetry(() => getProductBySlug(slug)).catch((err: unknown) => {
    // Duck-typing, inte bara `instanceof`: felet passerar unstable_cache och
    // prototypkedjan är inte garanterad på andra sidan.
    if (isNotFoundError(err)) return null;
    throw err;
  });
  if (!product) return null;

  const listingCutoff = new Date();
  listingCutoff.setDate(listingCutoff.getDate() - TRADERA_LISTING_MAX_AGE_DAYS);
  const [historyBySource, similar, railRows, rejectedItems, affiliateRetailers, variantSiblings] = await Promise.all([
    getPriceHistoryBySource(product.id, DETAIL_MAX_DAYS),
    getSimilarProducts(product.id, 4),
    prisma.traderaListing.findMany({
      where: { productId: product.id, lastSeenAt: { gte: listingCutoff } },
      orderBy: { price: "asc" },
      select: { itemId: true, title: true, price: true, url: true, imageUrl: true },
    }).then((rows) =>
      rows.map((r) => ({
        ...r,
        // Äldre rader lagrade API:ts /thumbs/ (64x64, suddig uppskalad) — samma
        // CDN-path serverar /medium-fit/ (600x460). Ingest lagrar numera
        // medium-fit direkt; det här är no-op för nya rader.
        imageUrl: r.imageUrl?.replace("/thumbs/", "/medium-fit/") ?? null,
      }))
    ),
    // Annonser som bevisligen INTE är produkten (LLM-dom eller manuell purge).
    // Svepet återskapar dem aldrig, men en skena-rad som skrevs INNAN domen
    // ligger kvar tills produkten namn-söks igen — och rotationen tar ~100 dygn.
    prisma.traderaMatch.findMany({
      where: { productId: product.id, ok: false },
      select: { itemId: true },
    }),
    prisma.retailer.findMany({
      where: {
        id: { in: product.offers.map((o) => o.retailerId) },
        affiliateEnabled: true,
      },
      select: { id: true },
    }),
    // Andra produkter för samma kort = Cardmarket-versioner (common ↔ variant).
    product.cardId
      ? prisma.product.findMany({
          where: { cardId: product.cardId, id: { not: product.id } },
          select: { slug: true, variantLabel: true, offers: { select: { price: true, stockStatus: true, url: true } } },
        })
      : Promise.resolve([]),
  ]);
  const variants = variantSiblings.map((v) => ({
    slug: v.slug,
    // RÅ etikett, ALDRIG en färdig mening. `variantLabel` är produktdata
    // ("Reverse Holo", "1st Edition") och är samma i båda språken, men den
    // ETIKETTLÖSA versionen behöver ett ord — och det ordet är ÖVERSATT och hör
    // därför hemma i klienten. Stod som "Vanlig version" här, vilket gav svensk
    // text mitt i det engelska gränssnittet (rapporterat 2026-08-03).
    label: v.variantLabel,
    lowestPrice: computeLowestPrice(v.offers.filter((o) => isDirectOfferUrl(o.url))).price,
  }));
  const affiliateIds = new Set(affiliateRetailers.map((r) => r.id));

  // Endast direkta produktlänkar visas/räknas (samma regel som produktsidan).
  const directOffers = product.offers.filter((o) => isDirectOfferUrl(o.url));
  const prices = directOffers
    .map((o) => o.price)
    .filter((p): p is number => p !== null);
  const highestNow = prices.length > 0 ? Math.max(...prices) : null;
  const avgNow =
    prices.length > 0
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null;
  const directPriced = directOffers.filter(
    (o): o is (typeof directOffers)[number] & { price: number } => o.price !== null
  );
  const directInStock = directPriced.filter((o) => o.stockStatus === "IN_STOCK");
  const lowestPool = directInStock.length > 0 ? directInStock : directPriced;
  const directLowest =
    lowestPool.length > 0
      ? lowestPool.reduce((a, b) => (b.price < a.price ? b : a))
      : null;

  // ── SKENAN FÅR SAMMA FRÅGA SOM OFFERTEN, FAST NU (2026-07-27) ──────────────
  // Skena-raderna vaktades när de SKREVS, mot det facit som fanns då. "Mega Darkrai
  // ex 116/084 Extended Artwork-ram" (179 kr) skrevs medan Pitch Black saknade
  // CM-data helt → ingen referens, ingen undre gräns, ramen passerade. Dagen efter
  // hade kortet ett CM-golv på 3 207 kr och offern städades bort manuellt — men
  // karusellen visade ramen vidare, eftersom raderna bara skrivs om när produkten
  // namn-söks igen (rotationen tar ~100 dygn för hela katalogen).
  // Facit = Cardmarket-priset, samma referens som skrivvakten använder.
  const cmReferenceOre =
    product.offers.find((o) => o.retailer.name === "Cardmarket" && o.price != null)?.price ?? null;
  const rejectedItemIds = new Set(rejectedItems.map((r) => r.itemId));
  const traderaListings = visibleListings(
    railRows.filter((r) => !rejectedItemIds.has(r.itemId)),
    cmReferenceOre
  );

  // Prishistorik: Cardmarket-trend i första hand — MEN bara så länge den fortfarande
  // uppdateras. En produkt som tappat sin CM-länk (t.ex. generisk butiks-stub utan
  // CM-motsvarighet) behåller sina gamla CM-punkter → utan recens-koll vann den frusna
  // CM-serien för alltid ("Cardmarket, senast 13 jul") medan butikerna postar färska
  // punkter dagligen. Välj därför CM bara om dess senaste punkt inte släpar mer än
  // TREND_STALE_DAYS efter butikernas färskaste; annars visa den levande butikstrenden.
  const latestDate = (s: SourceHistoryPoint[]): string | null =>
    s.length > 0 ? s[s.length - 1].date : null;
  const daysBetween = (a: string, b: string): number =>
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  const cmLatest = latestDate(historyBySource.cardmarket);
  const storeLatest = latestDate(historyBySource.butiker);
  const cmIsLive =
    cmLatest != null &&
    (storeLatest == null || daysBetween(cmLatest, storeLatest) <= TREND_STALE_DAYS);
  // Butiker kan inte längre VARA seriens källa (se HISTORY_SOURCE_KEYS) — men de
  // används fortfarande som FÄRSKHETSREFERENS ovan: släpar Cardmarket långt efter
  // butikernas senaste observation är CM-datat dött, oavsett om vi ritar butikerna.
  // CardTrader kommer före Tradera: för tryckningsvarianterna ÄR CardTrader priset.
  const trendSource: "cardmarket" | "cardtrader" | "tradera" = cmIsLive
    ? "cardmarket"
    : historyBySource.cardtrader.length > 0
      ? "cardtrader"
      : historyBySource.tradera.length > 0
        ? "tradera"
        : "cardmarket";
  const chartData = historyBySource[trendSource];
  const monthAgo = Date.now() - 30 * 86_400_000;
  const cm30 = chartData.filter((p) => new Date(p.date).getTime() >= monthAgo);
  const pctChange = (series: { price: number }[]): number | null =>
    series.length >= 2 && series[0].price > 0
      ? Math.round(
          ((series[series.length - 1].price - series[0].price) / series[0].price) * 10000
        ) / 100
      : null;
  const change30 = pctChange(cm30);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const change7 = pctChange(cm30.filter((p) => new Date(p.date).getTime() >= weekAgo));

  const serializedOffers: SerializedOffer[] = directOffers.map((o) => ({
    id: o.id,
    price: o.price,
    shippingPrice: o.shippingPrice,
    stockStatus: o.stockStatus,
    url: o.url,
    retailerId: o.retailerId,
    retailer: {
      id: o.retailer.id,
      name: o.retailer.name,
      logoUrl: o.retailer.logoUrl,
      websiteUrl: o.retailer.websiteUrl,
      affiliateEnabled: affiliateIds.has(o.retailerId),
    },
  }));

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    category: product.category,
    language: product.language,
    description: product.description,
    imageUrl: product.imageUrl,
    watchCount: product.watchCount,
    updatedAt: new Date(product.updatedAt).toISOString(),
    set: product.set ? { id: product.set.id, name: product.set.name } : null,
    chartData,
    historyBySource: {
      cardmarket: historyBySource.cardmarket,
      cardtrader: historyBySource.cardtrader,
      tradera: historyBySource.tradera,
      traderaSold: historyBySource.traderaSold,
    },
    trendSource,
    change7,
    change30,
    offerCount: directOffers.length,
    stats: {
      lowestPrice: directLowest?.price ?? null,
      lowestPriceStockStatus: directLowest?.stockStatus ?? null,
      highestPrice: highestNow,
      avgPrice: avgNow,
      offerCount: directOffers.length,
    },
    serializedOffers,
    affiliateRetailerIds: affiliateRetailers.map((r) => r.id),
    similar,
    variants,
    traderaListings,
  };
}

const SIMILAR_INCLUDE = {
  set: { select: { id: true, name: true, releaseDate: true, totalCards: true } },
  card: { select: { name: true, number: true, rarity: true } },
  offers: { select: { price: true, stockStatus: true, url: true } },
} as const;

type SimilarRow = Prisma.ProductGetPayload<{ include: typeof SIMILAR_INCLUDE }>;

/**
 * Slår ihop två datum-sorterade listor till en närmast-referensdatum-först-lista.
 * `after` = referensdatum och framåt (stigande), `before` = äldre (fallande);
 * två pekare, kortast tidsavstånd vinner. Exporterad för test.
 */
export function mergeByDateProximity<T>(
  after: T[],
  before: T[],
  ref: Date,
  take: number,
  dateOf: (t: T) => Date | null | undefined
): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (out.length < take && (i < after.length || j < before.length)) {
    const a = i < after.length ? after[i] : null;
    const b = j < before.length ? before[j] : null;
    if (a == null) { out.push(b as T); j++; continue; }
    if (b == null) { out.push(a); i++; continue; }
    const da = Math.abs((dateOf(a)?.getTime() ?? Infinity) - ref.getTime());
    const db = Math.abs((dateOf(b)?.getTime() ?? Infinity) - ref.getTime());
    if (da <= db) { out.push(a); i++; } else { out.push(b); j++; }
  }
  return out;
}

/**
 * Liknande produkter = "vad skulle DEN HÄR köparen överväga istället?" i tre
 * nivåer som fylls uppifrån tills limit:
 *  1. Samma kategori + samma set — närmaste substituten (andra pack-varianter,
 *     settets andra chase-kort; singlar prövar samma raritet först).
 *  2. Samma kategori + andra set — sealed: närmast releasedatum först (samma
 *     sorts produkt i samma prisklass); singlar: samma raritet, populärast först.
 *  3. Samma set, andra kategorier — "gillar du settet, här är mer av det"
 *     (gamla nivå 1, medvetet degraderad: den blandade 44 kr-packs med
 *     1 500 kr-boxar för att de delade set).
 * Bara prissatta produkter (lowestPriceOre ≠ null) — katalogen döljer ändå
 * oprissatta, en rekommendation dit är en återvändsgränd. Språk matchas i
 * nivå 1–2 (EN och JP är separata katalogspår).
 */
async function getSimilarProductsRaw(productId: string, limit = 8) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      setId: true,
      category: true,
      language: true,
      set: { select: { releaseDate: true } },
      card: { select: { rarity: true } },
    },
  });
  if (!product) throw new ServiceError(404, "Produkten hittades inte.");

  const picked: SimilarRow[] = [];
  const pickedIds = new Set<string>([product.id]);
  const add = (rows: SimilarRow[]) => {
    for (const r of rows) {
      if (picked.length >= limit) break;
      if (pickedIds.has(r.id)) continue;
      pickedIds.add(r.id);
      picked.push(r);
    }
  };
  const remaining = () => limit - picked.length;
  // Prissatt OCH inte bortgömd av ägaren — nivå 1-3 nedan spridar in båda.
  const priced = { lowestPriceOre: { not: null }, ...NOT_HIDDEN } as const;
  const isSingle = product.category === "SINGLE_CARD";
  const rarity = product.card?.rarity ?? null;

  // Nivå 1: samma set + samma kategori.
  if (product.setId) {
    if (isSingle && rarity) {
      add(await prisma.product.findMany({
        where: {
          ...priced,
          setId: product.setId,
          category: product.category,
          language: product.language,
          card: { rarity },
          id: { notIn: [...pickedIds] },
        },
        include: SIMILAR_INCLUDE,
        orderBy: { viewCount: "desc" },
        take: remaining(),
      }));
    }
    if (remaining() > 0) {
      add(await prisma.product.findMany({
        where: {
          ...priced,
          setId: product.setId,
          category: product.category,
          language: product.language,
          id: { notIn: [...pickedIds] },
        },
        include: SIMILAR_INCLUDE,
        orderBy: { viewCount: "desc" },
        take: remaining(),
      }));
    }
  }

  // Nivå 2: samma kategori, andra set.
  if (remaining() > 0) {
    const base = {
      ...priced,
      category: product.category,
      language: product.language,
      id: { notIn: [...pickedIds] },
      ...(product.setId ? { setId: { not: product.setId } } : {}),
    };
    const refDate = product.set?.releaseDate ?? null;
    if (!isSingle && refDate) {
      const take = remaining();
      const [after, before] = await Promise.all([
        prisma.product.findMany({
          where: { ...base, set: { releaseDate: { gte: refDate } } },
          include: SIMILAR_INCLUDE,
          orderBy: [{ set: { releaseDate: "asc" } }, { viewCount: "desc" }],
          take,
        }),
        prisma.product.findMany({
          where: { ...base, set: { releaseDate: { lt: refDate } } },
          include: SIMILAR_INCLUDE,
          orderBy: [{ set: { releaseDate: "desc" } }, { viewCount: "desc" }],
          take,
        }),
      ]);
      add(mergeByDateProximity(after, before, refDate, take, (r) => r.set?.releaseDate));
    } else {
      add(await prisma.product.findMany({
        where: { ...base, ...(isSingle && rarity ? { card: { rarity } } : {}) },
        include: SIMILAR_INCLUDE,
        orderBy: { viewCount: "desc" },
        take: remaining(),
      }));
    }
  }

  // Nivå 3: samma set, andra kategorier.
  if (remaining() > 0 && product.setId) {
    add(await prisma.product.findMany({
      where: { ...priced, setId: product.setId, id: { notIn: [...pickedIds] } },
      include: SIMILAR_INCLUDE,
      orderBy: { viewCount: "desc" },
      take: remaining(),
    }));
  }

  // Sista utväg (gamla beteendet): samma kategori oavsett språk/prissättning.
  // ⛔ Den här grenen spridar INTE `priced` och behöver därför gömfiltret uttryckligen
  //    — annars är sista utvägen precis den väg en bortgömd produkt tar tillbaka in.
  if (remaining() > 0) {
    add(await prisma.product.findMany({
      where: { category: product.category, ...NOT_HIDDEN, id: { notIn: [...pickedIds] } },
      include: SIMILAR_INCLUDE,
      orderBy: { viewCount: "desc" },
      take: remaining(),
    }));
  }

  return picked.map((p) => {
    const lowest = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      category: p.category,
      imageUrl: p.imageUrl,
      language: p.language,
      setId: p.setId,
      setName: p.set?.name ?? null,
      setTotalCards: p.set?.totalCards ?? null,
      cardName: p.card?.name ?? null,
      cardNumber: p.card?.number ?? null,
      cardRarity: p.card?.rarity ?? null,
      variantLabel: p.variantLabel,
      lowestPrice: lowest.price,
      lowestPriceStockStatus: lowest.stockStatus,
    };
  });
}

/**
 * Aktuellt marknadsvärde (öre) per produkt-id = produktens lägsta pris
 * (singel = Cardmarket-trend, sealed = lägsta butikspris). Samma mått som
 * produktsidans rubrik. Produkter utan prissatt offer utelämnas.
 */
export async function getProductValues(
  productIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, offers: { select: { price: true, stockStatus: true, url: true } } },
  });
  for (const p of products) {
    const { price } = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
    if (price != null) map.set(p.id, price);
  }
  return map;
}

/**
 * Aktuellt marknadsvärde (öre) per kort-id via kortets produkt(er). Om flera
 * produkter pekar på samma kort väljs det lägsta priset. Kort utan prissatt
 * produkt utelämnas.
 *
 * ⛔ REVERSE HOLO UNDANTAS. Funktionen driver skannerns värdeuppskattning och
 * samlingsvärdet, och båda utgår från ett KORT — inte från en tryckning.
 * Skannern kan bevisligen inte skilja en reverse holo från det ordinarie kortet
 * (den matchar på konst och samlarnummer, som är identiska), så konventionen är
 * det ORDINARIE kortet — samma konvention som gör att Base-korten värderas som
 * Unlimited. Utan undantaget hade "lägsta produkten" tyst börjat rapportera
 * CardTraders reverse-golv för varje kort där det råkar underskrida Cardmarkets
 * baspris, dvs ett värde för en vara användaren inte skannade. Priserna kommer
 * dessutom från OLIKA marknadsplatser, så vilket som är lägst avgörs delvis av
 * vilken marknadsplats som är billigast — inte av vad kortet är värt.
 *
 * Tryckningar (Unlimited/Shadowless/1st Edition) undantas INTE: för Base finns
 * ingen etikettlös produkt alls, så ett generellt `variantLabel: null`-filter
 * hade gjort hela Base-setet värdelöst.
 */
export async function getCardValues(
  cardIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (cardIds.length === 0) return map;
  const products = await prisma.product.findMany({
    where: { cardId: { in: cardIds }, NOT: { variantLabel: { in: [...REVERSE_VARIANT_LABELS] } } },
    select: { cardId: true, offers: { select: { price: true, stockStatus: true, url: true } } },
  });
  for (const p of products) {
    if (!p.cardId) continue;
    const { price } = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
    if (price == null) continue;
    const prev = map.get(p.cardId);
    if (prev == null || price < prev) map.set(p.cardId, price);
  }
  return map;
}

// ponytail: publika läsfrågor cachas (datan uppdateras ~en gång/dygn av jobben).
// Sänker Neon network transfer — upprepade sidvisningar/crawls träffar cachen, inte DB:n.
/**
 * Antal träffar för ETT filterurval — driver "Visa N produkter"-knappen i mobilens
 * filter-sheets INNAN man tryckt på den (förut stod det kvar antalet för de redan
 * APPLICERADE filtren, så man fick välja i blindo).
 *
 * Samma villkor som feeden, inklusive fuzzy-reserven: hade knappen sagt "0 produkter"
 * och feeden sedan visat felstavningsträffarna vore siffran en lögn.
 *
 * KOSTNAD: en COUNT per urval. Klienten fördröjer anropet (så ett reglagedrag ger ETT
 * anrop, inte ett per pixel) och cachen nedan gör upprepade urval gratis — annars vore
 * det här precis den Neon-post vi medvetet undvek när filtret byggdes.
 */
async function countProductsRaw(params: SearchProductsParams): Promise<number> {
  const where = await whereForParams(params);
  const exact = await prisma.product.count({ where });
  if (exact > 0 || !params.query) return exact;
  const ids = await fuzzyIds(params.query);
  if (ids.length === 0) return 0;
  return prisma.product.count({
    where: { AND: [await whereForParams(params, undefined), { id: { in: ids } }] },
  });
}

export const countProducts = cachedRead(countProductsRaw, "countProducts", 300);

const cachedExploreFeed = cachedRead(getExploreFeedRaw, "getExploreFeed");
const cachedSearchProducts = cachedRead(searchProductsRaw, "searchProducts");

/**
 * PERSONALISERADE SVAR: EGEN CACHE, KORT TTL (2026-08-05).
 *
 * Förut gick de HELT förbi cachen. Invändningen var riktig men löste fel problem:
 * `unstable_cache` nycklar på argumenten, så ett userId ger visserligen en egen post,
 * men med timmes-TTL låg en användares ordning kvar en timme och en ny bevakning syntes
 * inte förrän den gick ut.
 *
 * Kostnadsmodellen gör det till fel avvägning: **Neons nota är VAKEN TID, och varje
 * väckning köper minst 300 s debiterad tid.** Ett ocachat svar är inte "några frågor
 * till" — det är en väckning, och en inloggad besökare som bläddrar väcker computen på
 * varje sidladdning även när sidan i övrigt är ISR-cachad. En utloggad besökare gör det
 * inte. Vi betalade alltså ett fast pris för att slippa 60 sekunders inaktualitet i en
 * SORTERINGSORDNING.
 *
 * `PERSONAL_TTL_SECONDS` (60) är valt så att invändningen försvinner i stället för att
 * bytas bort: en ny bevakning slår igenom inom en minut, vilket ingen hinner uppleva som
 * fel, och en bläddringssession (oändlig scroll = många anrop) ryms i ett fönster.
 *
 * ⛔ EGEN CACHE-NYCKEL ("…Personal"), inte samma som den utloggade. Delade de nyckel
 *    skulle `userId` bara vara ännu ett argument — och en dag någon gör `userId`
 *    valfritt i nyckeln läcker en användares ordning till alla. Två namn kan inte
 *    kollidera av misstag.
 * ⛔ HÖJ INTE TTL:en för att spara mer. Det som gör det här säkert är att fönstret är
 *    kortare än tålamodet; 600 s vore en synlig lögn om användarens egna data.
 */
export const PERSONAL_TTL_SECONDS = 60;

/** Se `loadPersonalIdsRaw` för varför den returnerar arrayer och inte Set. */
const cachedPersonalIds = cachedRead(
  loadPersonalIdsRaw,
  "personalIds",
  PERSONAL_TTL_SECONDS
);

const cachedPersonalExploreFeed = cachedRead(
  getExploreFeedRaw,
  "getExploreFeedPersonal",
  PERSONAL_TTL_SECONDS
);
const cachedPersonalSearchProducts = cachedRead(
  searchProductsRaw,
  "searchProductsPersonal",
  PERSONAL_TTL_SECONDS
);

export const getExploreFeed: typeof getExploreFeedRaw = (params, offset, limit) =>
  params.userId
    ? cachedPersonalExploreFeed(params, offset, limit)
    : cachedExploreFeed(params, offset, limit);

export const searchProducts: typeof searchProductsRaw = (params) =>
  params.userId ? cachedPersonalSearchProducts(params) : cachedSearchProducts(params);
// `singleFlight` UTANPÅ TTL-cachen: produktsidans `generateMetadata` och sidkroppen körs
// PARALLELLT i Next, så båda startade sitt uppslag innan den andra hunnit fylla
// TTL-cachen → getProductBySlugRaw kördes två gånger per kall rendering (mätt i
// produktion: 316 anrop mot 160 sidrenderingar). Nu delar de ett löfte.
export const getProductBySlug = singleFlight(
  cachedRead(getProductBySlugRaw, "getProductBySlug"),
  (slug) => slug
);
export const getPriceHistory = cachedRead(getPriceHistoryRaw, "getPriceHistory");
export const getPriceHistoryBySource = cachedRead(
  getPriceHistoryBySourceRaw,
  "getPriceHistoryBySource"
);
export const getSimilarProducts = cachedRead(getSimilarProductsRaw, "getSimilarProducts");
// Hela produktsidans data, cachad per slug → upprepade overlay-öppningar/sidvisningar
// träffar cachen (inte Neon). Datum serialiseras till strängar — ofarligt (se ProductDetailData).
export const loadProductDetail = singleFlight(
  cachedRead(loadProductDetailRaw, "loadProductDetail"),
  (slug) => slug
);
