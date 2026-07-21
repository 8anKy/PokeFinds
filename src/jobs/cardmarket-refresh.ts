/**
 * Automatisk Cardmarket-prisuppdatering via CardMarket API TCG (RapidAPI Pro).
 * Körs EN gång/dygn (Pro = 3000 anrop/dygn; en full körning ~1100 anrop).
 *
 * - Singlar: engelska NM-lägsta "From" (`lowest_near_mint`) EXAKT (matchar CM 1:1,
 *   ingen utjämning) × live-kurs. Matchas mot vår DB via tcgid = Card.tcgExternalId.
 * - Sealed: CM lägsta (`lowest`) för rätt-matchad produkt (set+form+namnlikhet).
 *
 * Delas av jobb-schemaläggaren (worker.ts/instrumentation) och CLI-wrappers.
 * Prishistoriken/grafen (CM trend) rörs INTE — bara Offer.price.
 */
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { getRatesOre } from "../lib/exchange-rate";
import { cmImageProxyUrl, cmRenderExists } from "../lib/cm-image";
import {
  cardmarketJapaneseProductUrl,
  cardmarketProductUrl,
  isEnglishCardmarketUrl,
  withNearMint,
} from "../lib/marketplace-urls";
import { judgeSameProduct } from "../lib/same-product";
import { classifyForm, scoreSimilarity } from "../scrapers/matching";
import { recomputeProductPriceCache, snapshotStorePricedProducts } from "../services/products";
import { fetchTcgCardById, cardMarketPriceOre } from "../scrapers/adapters/pokemontcg-adapter";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Samtidiga DB-skrivningar (≤ DB_POOL i db.ts). Kortar 18k sekventiella
// cross-region-uppdateringar från ~30 min till några minuter.
const DB_CONCURRENCY = 8;
// Samtidiga API-sidhämtningar. Döljer nätverkslatens (US-runner → RapidAPI)
// utan att överskrida 300/min: varje task sover throttle×API_CONCURRENCY.
const API_CONCURRENCY = 4;

interface CmCard {
  tcgid: string | null;
  cardmarket_id: number | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
}
interface ApiProduct {
  name: string;
  cardmarket_id: number | null;
  image?: string;
  prices?: {
    cardmarket?: {
      lowest?: number | null;
      "30d_average"?: number | null;
      available_items?: number | null;
      // Språk-överstyrda lägsta (DE/FR/ES/IT) — används av tunndata-vakten nedan.
      lowest_DE?: number | null;
      lowest_FR?: number | null;
      lowest_ES?: number | null;
      lowest_IT?: number | null;
    } | null;
  } | null;
  episode?: { name?: string } | null;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// Prisvakt mot glitchad lowest åt BÅDA håll. En äkta CM From/lowest (billigaste
// aktuella annonsen) sitter alltid i botten av spannet: aldrig <20% av 30d-snittet
// (RapidAPI gav 2026-07-03 €0.03 på en €300-box → 0,33 kr) och aldrig långt ÖVER
// det heller — golvet kan per definition inte ligga 1,8x över snittet. 2026-07-03
// gav RapidAPI €9.9 på ett €4.9-snitt (2,0x) för Paradox Rift Booster; det slank
// under 3x-dagvakten och frös headline på ~113 kr. Utanför [0.2x, 1.8x] av snittet
// = glitch → fall tillbaka på 30d-snittet. ponytail: 1.8x fångar glitchen med marg;
// en genuint stigande marknad döljs tillfälligt bakom snittet (self-heal nästa dag).
export const HIGH_MULT = Number(process.env.CM_HIGH_MULT) || 1.8;
export function sanePriceEur(low: number | null | undefined, avg: number | null | undefined): number | null {
  const l = low ?? null, a = avg ?? null;
  if (l != null && l > 0 && (a == null || (l >= a * 0.2 && l <= a * HIGH_MULT))) return l;
  return a;
}

// ── CM:s EGEN TREND SOM FACIT (mätt 2026-07-14) ──────────────────────────────
// sanePriceEur behöver en referens (`avg`) för att kunna döma `low`. Saknas den
// släpps `low` igenom OGRANSKAT — se `a == null ||` ovan. RapidAPI saknar
// 30d_average på ~1% av sealed (20 av 1954), så hålet är litet men verkligt.
//
// Referensen hämtas därför från CM:s EGEN officiella prisguide (samma publika
// export som JP-pris redan läser — ingen skrapning). Den är bättre än RapidAPI:s
// snitt på TVÅ sätt: den finns alltid, och den är rätt på tunn vintage där snittet
// är kraftigt underskattat (se kommentaren vid `const ref` i sealed-fasen).
// `trend` är verifierad mot CM:s produktsida och stämde EXAKT (142,93 och 184,90).
//
// VARFÖR trend och inte guidens `low`: CM:s egen "From" är ibland ren skräp.
// Stormfront Booster visar "From 9,95 €" — den annonsen säger ordagrant
// "EMPTY PACKS". Att spegla CM:s lägsta rakt av skulle prissätta en vintage-
// booster till ett tomt omslag. Lägsta är rätt HEADLINE, men trend är rätt
// SANITETSREFERENS.
// Golv: CM:s guide innehåller nollställda/mikroskopiska trend-värden (0,02 € på
// "Emerald Booster Box", "Team Rocket Returns Booster Box", "151: Costco 5-Pack Mini
// Tin Bundle"). En sealed-produkt kostar aldrig under ~0,5 € — ett sådant "facit" är
// korrupt, inte billigt. Utan det här golvet blir facitet en BAKDÖRR: dagvaktens
// nödutgång ser att en glitchad lowest (0,02 €) "stämmer med trenden" och släpper in
// den. Mätt: 151-bundlen skulle läkas 3 309 kr → 0,23 kr.
const MIN_SEALED_EUR = 0.5;
const usable = (v: number | null | undefined): number | null =>
  v != null && v >= MIN_SEALED_EUR ? v : null;
export function cmGuideRefEur(g: CmGuideEntry | undefined): number | null {
  return usable(g?.trend) ?? usable(g?.avg) ?? null;
}

// ── ÄGARENS PRISREGEL: From → trend → 30d, med trend som FACIT (2026-07-18) ────
// From (lägsta NM) används BARA om den är rimlig mot CM:s EGEN trend. En From som
// ligger långt UNDER trenden (RapidAPI-feeden ser andra/billigare annonser än CM-
// sajtens synliga From — Aggron: From 3,50€ / RapidAPI-30d 2,16€ MOT guidens trend
// 8,45€ = sajtens From 9€) ELLER långt ÖVER (skräplistning, "EMPTY PACKS") är
// opålitlig → hoppa till trend, sedan 30d. Utan trend att döma mot: lita på From
// (oförändrat). Self-heal nästa dag om det var en äkta rörelse (trenden hinner ikapp).
// Detta är exakt ägarens fallback-kedja — den hoppar nu även en From som FINNS men
// är trasig, inte bara en From som SAKNAS. [LOW, HIGH] × trend = "rimlig From".
// 0.45: fångar en klart trasig From (Aggron 3,50€ = 0,41x trend) men skonar en
// genuint fallande chase-From (Bloodmoon Ursaluna ex 49,9€ = 0,49x, under sitt 30d-
// snitt = äkta prisfall/fynd, inte skräpdata). Snävare golv skulle dölja äkta fynd
// för snipern. Justerbart via CM_TREND_LOW_MULT.
export const TREND_LOW_MULT = Number(process.env.CM_TREND_LOW_MULT) || 0.45;
export const TREND_HIGH_MULT = Number(process.env.CM_TREND_HIGH_MULT) || 2;
export function fromElseTrend(
  fromEur: number | null | undefined,
  trendEur: number | null | undefined,
  avg30Eur: number | null | undefined,
): number | null {
  const f = fromEur != null && fromEur > 0 ? fromEur : null;
  const t = trendEur != null && trendEur > 0 ? trendEur : null;
  const a = avg30Eur != null && avg30Eur > 0 ? avg30Eur : null;
  // Rimlig From (eller ingen trend att döma mot) → använd From.
  if (f != null && (t == null || (f >= t * TREND_LOW_MULT && f <= t * TREND_HIGH_MULT))) return f;
  // From saknas/opålitlig → trend, sedan 30d, sist From (om det var allt vi hade).
  return t ?? a ?? f;
}

/**
 * Prissätter en sealed-produkt DIREKT från CM:s officiella prisguide — samma From→trend→
 * 30d-regel som RapidAPI-vägen, men utan RapidAPI. Används för EN-produkter vars idProduct
 * INTE finns i RapidAPI-katalogen (Trick or Trade, vintage) och som annars aldrig prissätts
 * dagligen (fryser). Exakt samma väg som JP-refreshen redan använder.
 *
 * `accepted` = TRUE när priset är CM:s faktiska From (köpbar annons) → IN_STOCK; FALSE när
 * From förkastades/saknades och vi föll tillbaka på trend/30d → OUT_OF_STOCK (uppskattning).
 * Returnerar null när guiden saknar användbar data (< MIN_SEALED_EUR överallt).
 */
export function priceFromGuide(g: CmGuideEntry | undefined): { eur: number; accepted: boolean } | null {
  const low = usable(g?.low);
  const eur = sanePriceEur(low, cmGuideRefEur(g));
  if (eur == null || eur <= 0) return null;
  return { eur, accepted: low != null && eur === low };
}

// ── VÅR STABILA HISTORIK SOM FACIT (ägarens regel-tillägg, 2026-07-15) ────────
// Ägarens prisregel: FROM > TREND > 30-dagssnitt, aldrig 1-dagsspiken. Men CM-GUIDEN
// SJÄLV glitchar ibland: Skyridge visade trend/avg ~97k€ (1-dagsspiken) i stället för
// det stabila ~42k€. Då är guidens 30-dagssnitt-FÄLT också korrupt och sanningen finns
// bara i VÅR egen historik. Signaturen: en PLATT historik (låg spridning) + ett dagsvärde
// som avviker → glitchen ligger i dagsvärdet, inte i marknaden. Returnerar historik-
// medianen (öre) BARA när historiken är stabil nog att lita på (≥5 pkt, spridning <1.5x).
// Volatil historik = äkta marknad → returnera null (rör inte priset).
export function stableHistoryOre(snapshotOre: number[]): number | null {
  const v = snapshotOre.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 5) return null;
  if (v[v.length - 1] / v[0] > 1.5) return null;
  return v[Math.floor(v.length / 2)];
}

/** CM:s officiella prisguide (idProduct → low/trend/avg). Publik export, ingen scraping. */
let cmGuideCache: Map<number, CmGuideEntry> | null = null;
export async function fetchCmGuide(): Promise<Map<number, CmGuideEntry>> {
  if (cmGuideCache) return cmGuideCache;
  const r = await fetch(CM_PRICE_GUIDE_URL);
  if (!r.ok) {
    console.error(`[cm-refresh] prisguide HTTP ${r.status} — sanitetsreferens saknas denna körning`);
    return new Map();
  }
  const guide = (await r.json()) as { priceGuides: CmGuideEntry[] };
  cmGuideCache = new Map(guide.priceGuides.map((e) => [e.idProduct, e]));
  return cmGuideCache;
}

/**
 * idProducts som finns i CM:s SEALED-katalog (products_nonsingles_6.json). Används av
 * EN-guide-fallbacken för att GARANTERA att vi bara guide-prissätter mot en riktig sealed-
 * produkt — ALDRIG mot en singel (annars återuppstår Venusaur→Surfing Pikachu-buggen: en
 * sealed-offer som pekar på ett singel-idProduct skulle spåra kortets pris). Tom mängd vid
 * hämtningsfel → fallbacken avstår helt (ingen regression). Samma export som JP-refreshen läser.
 */
let cmSealedIdsCache: Set<number> | null = null;
export async function fetchCmSealedIds(): Promise<Set<number>> {
  if (cmSealedIdsCache) return cmSealedIdsCache;
  const r = await fetch(CM_NONSINGLES_URL);
  if (!r.ok) {
    console.error(`[cm-refresh] nonsingles-katalog HTTP ${r.status} — EN-guide-fallback avstår denna körning`);
    return new Set();
  }
  const cat = (await r.json()) as { products: { idProduct: number }[] };
  cmSealedIdsCache = new Set(cat.products.map((p) => p.idProduct));
  return cmSealedIdsCache;
}

// Dag-över-dag-vakt: en äkta CM-From/lowest rör sig aldrig ≥3x på ett dygn. Ett sådant
// hopp = glitchad RapidAPI-data (2026-07-05 korrumperade 2104 priser, både uppåt på
// commons och krascher på boxar). Behåll då gårdagens snapshot-värde tills nästa körning.
// sanePriceEur fångar bara micro-krascher (<20% av snittet), inte inflation → denna vakt
// täcker BÅDA riktningarna. `priorOre` = produktens senaste snapshot-avgPrice före idag.
export const DAY_MOVE_MAX = Number(process.env.CM_DAY_MOVE_MAX) || 3;

// Under så här få aktuella CM-annonser är marknaden för tunn för att ett reservvärde
// (trend/30d-snitt) ska betyda något — se tunndata-vakten i sealed-fasen.
export const THIN_ITEMS = Number(process.env.CM_THIN_ITEMS) || 5;

// ── DAGVAKTEN VAR EN SPÄRRHAKE (rotorsak, mätt 2026-07-14) ───────────────────
// Utan `refOre` avvisar den ALLA ≥3x-rörelser — även den som RÄTTAR ett redan
// korrupt pris. Ett skräpvärde som en gång tagit sig in kunde därför aldrig
// lämna katalogen: rättelsen såg själv ut som en glitch och klämdes tillbaka.
// Frusna i veckor (allt detta mätt mot LIVE RapidAPI + CM:s prisguide):
//   Paldean Fates: Skeledirge ex Prem.Coll  DB 79 kr    ← RapidAPI låg 149,90 €
//     (= EXAKT vad Cardmarkets sida visar: "From 149,90 €"). Rätt värde 1 733 kr.
//   Great Encounters Booster Box            DB 325 385 kr, CM-trend 1 497 €
//   Mega Charizard X ex Tin                 DB 100 kr,     CM-trend 30,95 €
// RapidAPI var alltså KORREKT hela tiden — vi vägrade skriva svaret.
//
// Fix: ett stort hopp är en glitch bara om det går BORT från ett oberoende
// facit. Går det MOT CM:s egen trend är det en rättelse → släpp igenom.
// Log-avstånd så att jämförelsen är kvot-symmetrisk (2x upp == 2x ner).
export function saneDayMove(
  newOre: number,
  priorOre: number | null | undefined,
  refOre?: number | null,
): number {
  if (priorOre == null || priorOre <= 0) return newOre;
  const r = newOre / priorOre;
  if (r < DAY_MOVE_MAX && r > 1 / DAY_MOVE_MAX) return newOre; // normal dagsrörelse
  // Stort hopp: glitch eller självläkning? Facit avgör.
  // MARGINAL, inte strikt <: vid ett jämnt lopp skiljer flyttalsbruset (2e-16) och
  // vakten skulle "läka" på en slantsingling. Kräv att det nya värdet ligger KLART
  // närmare facit — annars behåll gårdagens (konservativt: en glitch släpps hellre
  // inte in än att en rättelse dröjer ett dygn).
  if (refOre != null && refOre > 0 && newOre > 0) {
    const distNew = Math.abs(Math.log(newOre / refOre));
    const distPrior = Math.abs(Math.log(priorOre / refOre));
    if (distNew < distPrior * 0.9) return newOre; // klart närmare CM:s trend → rättelse
  }
  return priorOre;
}

/** Senaste snapshot-avgPrice FÖRE idag per produkt (last-known-good för dag-vakten). */
async function priorSnapshotMap(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<{ productId: string; prev: number }[]>(
    `SELECT DISTINCT ON ("productId") "productId", "avgPrice" AS prev
     FROM "PriceSnapshot" WHERE "productId" = ANY($1) AND date < CURRENT_DATE AND "avgPrice" > 0
     ORDER BY "productId", date DESC`,
    productIds
  );
  return new Map(rows.map((r) => [r.productId, r.prev]));
}

/**
 * Klämmer orimliga dagshopp mot gårdagens snapshot. `refOre` (CM:s egen trend) är
 * spärrhakens nödutgång — utan den kan ett korrupt pris aldrig rättas (se saneDayMove).
 * Returnerar {clamped, healed}.
 */
async function clampDayMoves(
  ops: { productId: string; priceOre: number | null; refOre?: number | null }[],
): Promise<{ clamped: number; healed: number }> {
  const prior = await priorSnapshotMap(ops.map((o) => o.productId));
  let clamped = 0, healed = 0;
  for (const op of ops) {
    if (op.priceOre == null) continue; // tunndata-op: inget pris att klämma
    const prev = prior.get(op.productId);
    const safe = saneDayMove(op.priceOre, prev, op.refOre);
    if (safe !== op.priceOre) {
      op.priceOre = safe;
      clamped++;
    } else if (prev && (op.priceOre / prev >= DAY_MOVE_MAX || op.priceOre / prev <= 1 / DAY_MOVE_MAX)) {
      healed++; // stort hopp som SLÄPPTES igenom = rättelse mot CM-trend
    }
  }
  return { clamped, healed };
}
const EXPECTED_FORM: Record<string, string> = {
  BOOSTER_BOX: "display", BOOSTER_PACK: "booster", ETB: "etb",
  BUNDLE: "bundle", COLLECTION_BOX: "collection", BLISTER: "blister", TIN: "tin",
};

// Global namnmatch (set-lösa stubs) kräver högre tröskel än set-scopat: hela
// katalogen är i spel, så namnet måste ensamt bära set-infon.
const SET_SCOPED_MIN_SCORE = 0.55;
const GLOBAL_MIN_SCORE = 0.72;

/**
 * Bästa CM-katalogmatch för en sealed-produkt (form-gate + namnlikhet). Med set
 * = set-scopat som förr. UTAN set (auto-importerade butiks-stubs saknar episode)
 * = matcha mot HELA katalogen med högre tröskel så de ändå får CM-pris/trend.
 * ponytail: global namnmatch kan fel-länka udda titlar; store-cross-check i
 * anroparen (priceOre > storeMin×2.5 → skip) är säkerhetsnätet — höj
 * GLOBAL_MIN_SCORE om fel-länkningar dyker upp.
 */
export function bestSealedMatch(
  product: { title: string; category: string; setName: string | null },
  apiProducts: ApiProduct[],
  byEpisode: Map<string, ApiProduct[]>
): { match: ApiProduct; score: number } | null {
  const setLess = !product.setName;
  const cands = setLess ? apiProducts : byEpisode.get(norm(product.setName!));
  if (!cands?.length) return null;
  const minScore = setLess ? GLOBAL_MIN_SCORE : SET_SCOPED_MIN_SCORE;
  const expForm = EXPECTED_FORM[product.category] ?? null;
  const ourClean = norm(product.title);
  let best: ApiProduct | null = null;
  let bestScore = 0;
  for (const c of cands) {
    if (expForm && classifyForm(c.name) !== expForm) continue;
    if (product.category === "BOOSTER_BOX" && !/booster/i.test(c.name)) continue;
    const s = scoreSimilarity(ourClean, norm(c.name));
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best && bestScore >= minScore ? { match: best, score: bestScore } : null;
}

export interface CmRefreshResult {
  ran: boolean;
  singlesUpdated: number;
  singlesCreated: number;
  sealedUpdated: number;
  historyPoints: number;
  apiCalls: number;
  remaining: number;
}

/**
 * Prissätter SINGLE_CARD-produkter med variantLabel != null (specialvarianter
 * som Cardmarket listar separat men RapidAPI saknar) via pokemontcg.io:s
 * Cardmarket-trend för samma tcgExternalId. Uppdaterar CM-offer + skriver en
 * daglig historikpunkt så variantgrafen lever framåt. Returnerar antal kort.
 */
export async function runVariantRefresh(): Promise<number> {
  await getRatesOre(); // värm kursen (cardMarketPriceOre läser den synkront)
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const variants = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", variantLabel: { not: null }, card: { tcgExternalId: { not: null } } },
    select: { id: true, card: { select: { tcgExternalId: true } }, offers: { where: { retailerId: cm?.id }, select: { id: true }, take: 1 } },
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let n = 0;
  for (const p of variants) {
    const ext = p.card?.tcgExternalId;
    if (!ext) continue;
    const card = await fetchTcgCardById(ext);
    if (!card) continue;
    const priceOre = cardMarketPriceOre(card); // CM-trend (EUR) → öre
    if (priceOre == null) continue;
    const offerId = p.offers[0]?.id;
    if (offerId) {
      await prisma.offer.update({ where: { id: offerId }, data: { price: priceOre, stockStatus: "IN_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() } });
    }
    if (cmSource) {
      await prisma.priceObservation.create({ data: { productId: p.id, sourceId: cmSource.id, price: priceOre, currency: "SEK" } });
      await prisma.priceSnapshot.upsert({
        where: { productId_date: { productId: p.id, date: today } },
        update: { minPrice: priceOre, maxPrice: priceOre, avgPrice: priceOre },
        create: { productId: p.id, date: today, minPrice: priceOre, maxPrice: priceOre, avgPrice: priceOre, volume: 1 },
      });
    }
    n++;
  }
  if (n > 0) console.log(`[cm-refresh] Varianter: ${n} prissatta via pokemontcg.io-trend.`);
  return n;
}

// ── Japanska sealed: officiella Cardmarket-prisguiden ────────────────────────
// Japanska set har EGNA produktsidor på Cardmarket (JP-bannrade expansioner) och
// finns INTE i RapidAPI-katalogen. Priskälla = CM:s officiella publika dataexporter
// (samma som import-cardmarket-priceguide.ts — ingen scraping):
//   prisguiden ger `low` (lägsta aktuella annons) + `trend`/`avg` per idProduct.
// Pris vi visar = `low` (lägsta, samma semantik som EN-sealed); ur lager utan
// aktuell annons → trend/avg + OUT_OF_STOCK. Länk = idProduct + language=7
// (japanska annonser). Mappningen productId→idProduct bor i CM-offerens URL
// (DB-driven — funkar i molnjobb utan lokala cachefiler).
const CM_PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const CM_NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

interface CmGuideEntry {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg30: number | null;
}
interface CmNonSingle {
  idProduct: number;
  name: string;
  categoryName: string;
  idExpansion: number;
}

/** CM-katalogkategorier som får matchas per vår produktkategori (JP-mappning). */
const JP_CM_CATEGORIES: Record<string, string[]> = {
  BOOSTER_PACK: ["Pokémon Booster"],
  BOOSTER_BOX: ["Pokémon Display"],
  ETB: ["Pokémon Elite Trainer Boxes"],
  TIN: ["Pokémon Tins"],
  COLLECTION_BOX: ["Pokémon Box Set"],
  BUNDLE: ["Pokémon Box Set", "Pokémon Display"],
  BLISTER: ["Pokémon Blisters", "Pokémon Booster"],
};

/** Städar en JP-produkttitel till CM-jämförbar form (era-/språk-/kodbrus bort). */
export function jpComparableTitle(title: string): string {
  return norm(
    title
      // språkmarkörer + parentes-/bindestrecksvarianter
      .replace(/\(?\b(japansk\w*|japanese|jpn?)\b\)?/gi, " ")
      // set-koder: sv2D, s12a, sm10b, m1L, sv4A … (även inom parentes/efter streck)
      .replace(/[([-]?\s*\b(?:sv|swsh|sm|xy|bw|s|m)\d{1,2}[a-z]{0,2}\b\s*[)\]]?/gi, " ")
      // era-prefix — CM:s JP-namn bär dem inte ("Clay Burst Booster Box")
      .replace(/\b(scarlet\s*(&|and|&amp;)?\s*violet|sword\s*(&|and|&amp;)?\s*shield|sun\s*(&|and|&amp;)?\s*moon)\b/gi, " ")
      // innehålls-/formbrus som CM inte använder i namnet
      .replace(/\(\d+\s*(cards?|kort|pack|boosters?)\)/gi, " ")
      .replace(/\bdisplay\s*\/\s*booster box\b/gi, "booster box")
      .replace(/\bhigh class pack\b/gi, " ")
      .replace(/&amp;/gi, "and")
  );
}

export interface JpRefreshResult {
  products: number;
  updated: number;
  mapped: number;
  unmatched: string[];
}

export async function runJapaneseSealedRefresh(): Promise<JpRefreshResult> {
  const res: JpRefreshResult = { products: 0, updated: 0, mapped: 0, unmatched: [] };
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) return res;
  const jpProducts = await prisma.product.findMany({
    where: { language: "JP", category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    include: { offers: { select: { id: true, retailerId: true, url: true, price: true, stockStatus: true } } },
  });
  res.products = jpProducts.length;
  if (jpProducts.length === 0) return res;

  const [guideRes, nonSinglesRes] = await Promise.all([
    fetch(CM_PRICE_GUIDE_URL),
    fetch(CM_NONSINGLES_URL),
  ]);
  if (!guideRes.ok || !nonSinglesRes.ok) {
    console.error(`[cm-jp] prisguide/katalog HTTP ${guideRes.status}/${nonSinglesRes.status}`);
    return res;
  }
  const guide = (await guideRes.json()) as { priceGuides: CmGuideEntry[] };
  const catalog = (await nonSinglesRes.json()) as { products: CmNonSingle[] };
  const guideById = new Map(guide.priceGuides.map((e) => [e.idProduct, e]));

  // idProducts som redan ägs av en produkt (via CM-offer-URL) — en kandidat som
  // ägs av NÅGON ANNAN produkt är per definition fel match (vår EN-katalog är
  // komplett → alla internationella produkter är redan ägda → kvarvarande
  // oägda kandidater är i praktiken japanska/udda).
  const cmOffers = await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "idProduct=" } },
    select: { productId: true, url: true },
  });
  const ownedBy = new Map<number, string>();
  for (const o of cmOffers) {
    const m = o.url?.match(/idProduct=(\d+)/);
    if (m) ownedBy.set(parseInt(m[1], 10), o.productId);
  }

  const rates = await getRatesOre();
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  type JpOp = { productId: string; offerId?: string; idProduct: number; priceOre: number; refOre?: number | null; stock: "IN_STOCK" | "OUT_OF_STOCK" };
  const ops: JpOp[] = [];

  for (const p of jpProducts) {
    const cmOffer = p.offers.find((o) => o.retailerId === cm.id);
    let idProduct: number | null = null;
    const idm = cmOffer?.url?.match(/idProduct=(\d+)/);
    if (idm) idProduct = parseInt(idm[1], 10);

    // Auto-mappning för JP-produkter utan CM-offer: namn-match mot CM-katalogen
    // (rätt CM-kategori, oägt idProduct) + LLM-dom som SISTA vakt. Utan
    // ANTHROPIC_API_KEY krävs nära-exakt namn (≥0.9) för att mappa.
    if (idProduct == null) {
      const ourClean = jpComparableTitle(p.title);
      const allowedCats = JP_CM_CATEGORIES[p.category] ?? null;
      const cands = catalog.products
        .filter(
          (c) =>
            (!allowedCats || allowedCats.includes(c.categoryName)) &&
            !/coin|lot|single/i.test(c.categoryName) &&
            (ownedBy.get(c.idProduct) === undefined || ownedBy.get(c.idProduct) === p.id)
        )
        .map((c) => ({ c, sim: scoreSimilarity(ourClean, norm(c.name)) }))
        .filter((x) => x.sim >= 0.5)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);
      for (const { c, sim } of cands) {
        const verdict = await judgeSameProduct(
          p.title,
          c.name,
          "B är Cardmarkets produktnamn. Japanska set har EGNA produktsidor på Cardmarket med setets japanska namn (t.ex. 'Pokémon Card 151' = japanska 151-setet, medan '151' ensamt = internationella utgåvan). A är en JAPANSK produkt — B måste vara SAMMA japanska set och produkttyp."
        );
        const accept = verdict ? verdict.same : sim >= 0.9;
        if (accept) {
          idProduct = c.idProduct;
          ownedBy.set(c.idProduct, p.id);
          res.mapped++;
          console.log(`[cm-jp] mappade "${p.title}" → ${c.idProduct} "${c.name}" (sim ${sim.toFixed(2)})`);
          break;
        }
      }
      if (idProduct == null) {
        res.unmatched.push(p.title);
        continue;
      }
    }

    const g = guideById.get(idProduct);
    if (!g) continue;
    // Lägsta pris ("low") = det vi visar/spårar; utan aktuell annons → trend/avg
    // som ur-lager-referens (samma semantik som EN-sealed). sanePriceEur skyddar
    // mot glitchade micro-/jättepriser.
    const eur = sanePriceEur(g.low, g.trend ?? g.avg);
    if (eur == null) continue;
    const stock = g.low != null && eur === g.low ? "IN_STOCK" : "OUT_OF_STOCK";
    const refEur = cmGuideRefEur(g);
    ops.push({
      productId: p.id, offerId: cmOffer?.id, idProduct,
      priceOre: Math.round(eur * rates.eurToOre),
      refOre: refEur != null ? Math.round(refEur * rates.eurToOre) : null,
      stock,
    });
  }

  const jp = await clampDayMoves(ops);
  if (jp.clamped) console.log(`[cm-jp] klämde ${jp.clamped} orimliga dagshopp till gårdagens värde.`);
  if (jp.healed) console.log(`[cm-jp] LÄKTE ${jp.healed} tidigare korrupta priser (stort hopp mot CM-trend).`);

  for (const op of ops) {
    const url = cardmarketJapaneseProductUrl(op.idProduct);
    if (op.offerId) {
      await prisma.offer.update({
        where: { id: op.offerId },
        data: { price: op.priceOre, url, stockStatus: op.stock, condition: "SEALED", language: "JP", lastSeenAt: new Date() },
      });
    } else {
      await prisma.offer.upsert({
        where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "JP" } },
        update: { price: op.priceOre, url, stockStatus: op.stock, lastSeenAt: new Date() },
        create: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "JP", price: op.priceOre, currency: "SEK", stockStatus: op.stock, url },
      });
    }
    if (cmSource) {
      await prisma.priceObservation.create({
        data: { productId: op.productId, sourceId: cmSource.id, price: op.priceOre, currency: "SEK" },
      });
      await prisma.priceSnapshot.upsert({
        where: { productId_date: { productId: op.productId, date: today } },
        update: { minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre },
        create: { productId: op.productId, date: today, minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre, volume: 1 },
      });
    }
    res.updated++;
  }

  if (res.unmatched.length) {
    console.log(`[cm-jp] ${res.unmatched.length} JP-produkter utan CM-mappning: ${res.unmatched.slice(0, 10).join(" | ")}${res.unmatched.length > 10 ? " …" : ""}`);
  }
  console.log(`[cm-jp] ${res.updated}/${res.products} JP-produkter prisuppdaterade (${res.mapped} nymappade).`);
  return res;
}

export async function runCardmarketRefresh(
  opts: { singles?: boolean; sealed?: boolean; throttleMs?: number } = {}
): Promise<CmRefreshResult> {
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
  const throttle = opts.throttleMs ?? 220;
  const res: CmRefreshResult = { ran: false, singlesUpdated: 0, singlesCreated: 0, sealedUpdated: 0, historyPoints: 0, apiCalls: 0, remaining: Infinity };
  if (!KEY) {
    console.warn("[cm-refresh] CARDMARKET_RAPIDAPI_KEY saknas — hoppar över.");
    return res;
  }
  res.ran = true;

  const api = async <T>(url: string): Promise<T | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
      const rem = r.headers.get("x-ratelimit-requests-remaining");
      if (rem != null) res.remaining = parseInt(rem, 10);
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!r.ok) { console.error(`[cm-refresh] ${r.status} ${url}`); return null; }
      res.apiCalls++;
      return (await r.json()) as T;
    }
    return null;
  };

  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) { console.warn("[cm-refresh] Cardmarket-retailer saknas."); return res; }

  if (opts.singles !== false) {
    const products = await prisma.product.findMany({
      // variantLabel:null = bas-common. Specialvariter (GameStop-promo, reverse
      // m.m.) prissätts INTE av RapidAPI (saknar dem) utan av runVariantRefresh.
      where: { category: "SINGLE_CARD", variantLabel: null, card: { tcgExternalId: { not: null } } },
      select: { id: true, card: { select: { tcgExternalId: true } }, offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 } },
    });
    const map = new Map<string, { productId: string; offerId?: string; url?: string }>();
    for (const p of products) {
      const ext = p.card?.tcgExternalId;
      if (ext) map.set(ext, { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url });
    }

    // Promo-/specialset utan pokemontcg.io-tcgid (t.ex. MEP Black Star Promos) →
    // matchas på cardmarket_id istället.
    const cmidMap = new Map<number, { productId: string; offerId?: string; url?: string }>();
    const cmidProducts = await prisma.product.findMany({
      where: { category: "SINGLE_CARD", card: { cardmarketId: { not: null }, tcgExternalId: null } },
      select: { id: true, card: { select: { cardmarketId: true } }, offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 } },
    });
    for (const p of cmidProducts) {
      const id = p.card?.cardmarketId;
      if (id != null) cmidMap.set(id, { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url });
    }

    const eps: { id: number; cards_total: number }[] = [];
    let page = 1, total = 1;
    do {
      const d = await api<{ data: { id: number; cards_total: number }[]; paging: { total: number } }>(`https://${HOST}/pokemon/episodes?page=${page}`);
      if (!d) break;
      total = d.paging.total;
      eps.push(...d.data);
      await sleep(throttle);
    } while (page++ < total);

    // Fas 1: hämta priser. Hämtningen är latensbunden (US-runner → RapidAPI, en
    // sida i taget tar ~38 min). Kör API_CONCURRENCY sidor parallellt men låt
    // varje task sova throttle×API_CONCURRENCY → aggregerad takt ≤ 1/throttle
    // (~273/min, under 300/min-kvoten) oavsett latens. Fas 2: skriv samtidigt.
    const pageTasks: { epId: number; pg: number }[] = [];
    // CM_LIMIT_EPISODES > 0 → bara N första set (för lokal testning, sparar kvot).
    const limitEps = parseInt(process.env.CM_LIMIT_EPISODES ?? "0", 10);
    const withCards = eps.filter((e) => e.cards_total > 0);
    for (const ep of (limitEps > 0 ? withCards.slice(0, limitEps) : withCards)) {
      for (let pg = 1; pg <= Math.ceil(ep.cards_total / 20); pg++) pageTasks.push({ epId: ep.id, pg });
    }
    // MEP Black Star Promos (412) rapporterar cards_total=0 i episode-listan
    // (tcggo-metadata-bugg) men har ~93 kort → force-hämta dess sidor; matchas
    // på cardmarket_id nedan. Tomma sidor returnerar inget (ofarligt).
    if (cmidMap.size > 0) for (let pg = 1; pg <= 6; pg++) pageTasks.push({ epId: 412, pg });
    // CM:s officiella prisguide = trend-facit för From→trend→30d-regeln (RapidAPI-
    // singlar saknar trend-fält; deras egna 30d kan vara lika lågt som en glitchad From).
    const guide = await fetchCmGuide();
    const singleOps: { productId: string; offerId?: string; priceOre: number; url: string }[] = [];
    await mapPool(pageTasks, API_CONCURRENCY, async ({ epId, pg }) => {
      const d = await api<{ data: CmCard[] }>(`https://${HOST}/pokemon/episodes/${epId}/cards?page=${pg}`);
      await sleep(throttle * API_CONCURRENCY);
      if (!d) return;
      for (const card of d.data) {
        const entry =
          (card.tcgid ? map.get(card.tcgid) : undefined) ??
          (card.cardmarket_id != null ? cmidMap.get(card.cardmarket_id) : undefined);
        if (!entry) continue;
        const cmp = card.prices?.cardmarket ?? {};
        // From bara om rimlig mot CM:s EGEN trend (guiden), annars trend→30d.
        const g = card.cardmarket_id != null ? guide.get(card.cardmarket_id) : undefined;
        const eur = fromElseTrend(cmp.lowest_near_mint, g?.trend ?? g?.avg, g?.avg30 ?? cmp["30d_average"]);
        if (eur == null) continue;
        const priceOre = Math.round(eur * rates.eurToOre);
        const url =
          entry.url && isEnglishCardmarketUrl(entry.url) ? withNearMint(entry.url)
            : card.cardmarket_id != null ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true })
              : entry.url ?? null;
        if (!url) continue;
        singleOps.push({ productId: entry.productId, offerId: entry.offerId, priceOre, url });
      }
    });
    const single = await clampDayMoves(singleOps);
    if (single.clamped) console.log(`[cm-refresh] Singlar: klämde ${single.clamped} orimliga dagshopp (≥${DAY_MOVE_MAX}x) till gårdagens värde.`);
    await mapPool(singleOps, DB_CONCURRENCY, async (op) => {
      if (op.offerId) {
        await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: "IN_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() } });
        res.singlesUpdated++;
      } else {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
          update: { price: op.priceOre, url: op.url, stockStatus: "IN_STOCK", lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: "IN_STOCK", url: op.url },
        });
        res.singlesCreated++;
      }
    });

    // Daglig CM-historikpunkt per uppdaterat kort → matar produktgrafen
    // (getPriceHistoryBySource grupperar PriceObservation per dag/källa) + de
    // dagliga snapshotsen (landning/dashboard). Detta är ENDA källan till ÄKTA
    // daglig historik — den byggs FRAMÅT (ingen API ger en historisk serie).
    // Värdet = samma From-pris vi visar (lowest_near_mint).
    const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
    if (cmSource && singleOps.length > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      await prisma.priceObservation.createMany({
        data: singleOps.map((op) => ({ productId: op.productId, sourceId: cmSource.id, price: op.priceOre, currency: "SEK" })),
      });
      await prisma.priceSnapshot.createMany({
        data: singleOps.map((op) => ({ productId: op.productId, date: today, minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre, volume: 1 })),
        skipDuplicates: true,
      });
      res.historyPoints = singleOps.length;
    }
    console.log(`[cm-refresh] Singlar: ${res.singlesUpdated} uppdaterade, ${res.singlesCreated} nya, ${res.historyPoints} historikpunkter.`);
  }

  if (opts.sealed !== false) {
    const apiProducts: ApiProduct[] = [];
    let page = 1, total = 1;
    let failedPage: number | null = null;
    do {
      const d = await api<{ data: ApiProduct[]; paging: { total: number } }>(`https://${HOST}/pokemon/products?page=${page}`);
      // FAILA HÖGT. Förut stod här ett bart `break` → föll sida 1 bort (429/5xx efter
      // alla retries, eller slut på RapidAPI-kvot) blev sealed-katalogen TOM, hela
      // sealed-fasen gjorde tyst ingenting och jobbet blev ÄNDÅ GRÖNT. Det hände
      // 2026-07-09: "Sealed: 0 uppdaterade, 0 historikpunkter" — en hel dags sealed-
      // priser och historikpunkter förlorade, utan ett enda larm. En halv katalog är
      // lika illa: då hoppas produkterna på de uteblivna sidorna tyst över.
      if (!d) { failedPage = page; break; }
      total = d.paging.total;
      apiProducts.push(...d.data);
      await sleep(throttle);
    } while (page++ < total);

    if (failedPage !== null) {
      throw new Error(
        `[cm-refresh] Sealed-katalogen kunde inte hämtas: sida ${failedPage}/${total} gav null efter retries ` +
          `(${apiProducts.length} produkter hann hämtas). Avbryter med FEL så körningen blir röd — ` +
          `en grön körning här betyder tyst förlorade sealed-priser för hela dygnet. ` +
          `Vanligaste orsaken: RapidAPI-kvoten slut (1597/3000 används normalt) eller 429/5xx.`
      );
    }

    const byEpisode = new Map<string, ApiProduct[]>();
    const apiByCmId = new Map<number, ApiProduct>();
    for (const p of apiProducts) {
      const ep = norm(p.episode?.name ?? "");
      if (ep) (byEpisode.get(ep) ?? byEpisode.set(ep, []).get(ep)!).push(p);
      if (p.cardmarket_id != null) apiByCmId.set(p.cardmarket_id, p);
    }
    const ours = await prisma.product.findMany({
      where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
      include: {
        set: { select: { name: true } },
        offers: { select: { id: true, retailerId: true, price: true, stockStatus: true, url: true } },
        // Senaste snapshots → stabil historik-median som facit när CM-guiden glitchar.
        priceSnapshots: { select: { avgPrice: true }, orderBy: { date: "desc" }, take: 10 },
      },
    });
    // priceOre: null = tunn marknad, vi VET inte priset → offern nollas ("–"), ingen
    // historikpunkt. stock UNKNOWN (inte OUT_OF_STOCK: vi vet inte det heller).
    type SealedOp = {
      productId: string; offerId?: string; imageUrl?: string;
      priceOre: number | null; refOre?: number | null;
      url: string; stock: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
    };
    const sealedOps: SealedOp[] = [];
    // Vilka CM-produkter ÄGS redan? Seedas från befintliga CM-offers, så en fuzzy-match
    // aldrig kan kapa en idProduct som en annan katalogprodukt redan har. Se vakten nedan.
    const ownedCmIds = new Set<number>();
    for (const p of ours) {
      const existing = p.offers.find((o) => o.retailerId === cm.id);
      const m = existing?.url?.match(/idProduct=(\d+)/);
      if (m) ownedCmIds.add(parseInt(m[1], 10));
    }
    let skippedOwned = 0;
    // Sanitetsreferens + facit från CM:s egen prisguide (publik export, ingen scraping).
    const cmGuide = await fetchCmGuide();
    // Sealed-katalogens idProducts → EN-guide-fallbacken (nedan) prissätter BARA mot dessa.
    const sealedCmIds = await fetchCmSealedIds();
    let guarded = 0, thinSkipped = 0, usedHist = 0, guideFallback = 0;
    for (const p of ours) {
      // RapidAPI-katalogen är HELT engelsk (0 japanska set/produkter, verifierat
      // 2026-07-07) — icke-EN-produkter får ALDRIG matchas här (fyra olika japanska
      // boxar fuzzy-matchade alla mot EN "Scarlet & Violet Booster Box" och visade
      // dess pris). Japanska prissätts av runJapaneseSealedRefresh (officiella
      // prisguiden) istället.
      if (p.language !== "EN") continue;
      const cmOffer = p.offers.find((o) => o.retailerId === cm.id);
      // 1) Exakt via cardmarket_id (idProduct i offer-URL:en) — täcker även
      //    set-lösa produkter (tins m.m. som inte kan fuzzy-matchas på set).
      let best: ApiProduct | null = null;
      let exact = false;
      const idm = cmOffer?.url?.match(/idProduct=(\d+)/);
      if (idm) { best = apiByCmId.get(parseInt(idm[1], 10)) ?? null; exact = best != null; }
      // 1b) EN-GUIDE-FALLBACK: känt idProduct som INTE finns i RapidAPI men i CM-guiden.
      //     RapidAPI-katalogen missar Trick or Trade, vintage m.m. → utan detta prissätts de
      //     ALDRIG dagligen och fryser (ägaren hittade T&T 2023/2024 stilla sedan 15 juli).
      //     Prissätt då direkt från guiden (From→trend→30d, samma väg som JP-refreshen).
      //     HÅRD VAKT: bara mot idProducts i SEALED-katalogen — aldrig en singel (annars
      //     återuppstår Venusaur→Surfing Pikachu). Exakt idProduct från offern = betrodd länk;
      //     vi fuzzy-matchar ALDRIG mot guiden. Känt sealed-id → hoppa över fuzzy oavsett.
      if (!best && idm && cmOffer) {
        const gid = parseInt(idm[1], 10);
        if (sealedCmIds.has(gid)) {
          const priced = priceFromGuide(cmGuide.get(gid));
          if (priced) {
            let eur = priced.eur;
            // Samma historik-vakt som RapidAPI-vägen: glitchad guide + platt egen historik → median.
            const histOre = stableHistoryOre(p.priceSnapshots.map((s) => s.avgPrice));
            if (histOre != null) {
              const eurOre = eur * rates.eurToOre;
              if (Math.max(eurOre / histOre, histOre / eurOre) > 1.5) eur = histOre / rates.eurToOre;
            }
            const refEur = cmGuideRefEur(cmGuide.get(gid));
            sealedOps.push({
              productId: p.id, offerId: cmOffer.id,
              priceOre: Math.round(eur * rates.eurToOre),
              refOre: refEur != null ? Math.round(refEur * rates.eurToOre) : null,
              url: cardmarketProductUrl(gid), stock: priced.accepted ? "IN_STOCK" : "OUT_OF_STOCK",
            });
            ownedCmIds.add(gid);
            guideFallback++;
          }
          continue; // känt sealed-id: prissatt via guide (eller ingen guide-data) → ingen fuzzy
        }
      }
      // 2) Annars fuzzy (produkter utan CM-offer): set-scopat, ELLER globalt för
      //    set-lösa auto-importerade stubs så även de får CM-pris/trend.
      //    Kombo-/lot-produkter ("Booster + Mini Pärm", "ETB + Acrylic case") får
      //    ALDRIG fuzzy-länkas till basproduktens CM-sida — fel prisreferens.
      if (!best && ["combo", "multipack", "case", "event"].includes(classifyForm(p.title) ?? "")) continue;
      if (!best) {
        const m = bestSealedMatch(
          { title: p.title, category: p.category, setName: p.set?.name ?? null },
          apiProducts, byEpisode
        );
        if (!m) continue;
        best = m.match;
        // ── EN CM-PRODUKT = EN KATALOGPRODUKT ────────────────────────────────────
        // Den globala namn-matchningen (GLOBAL_MIN_SCORE 0.72) hade INGEN unikhetsvakt:
        // flera av våra titlar kunde vinna SAMMA CM-produkt, och alla utom en visade då
        // en FRÄMMANDE prisgraf. Mätt 2026-07-14: 16 kolliderande idProduct, 19 produkt-
        // sidor med fel kurva — bl.a. en enskild "Kanto Power Mini Tin" som visade
        // 5-pack-boxens 1 222 kr. Bryter mot regeln "inga fabricerade priser".
        //
        // Samma princip som cross-produkt-URL-vakten i runner.ts: ägs identiteten redan,
        // rör den inte. En produkt UTAN graf är alltid bättre än en med FEL graf.
        // (Exakt idProduct-träff ovan (`exact`) är undantagen — den ÄR ägarskapet.)
        if (best.cardmarket_id != null && ownedCmIds.has(best.cardmarket_id)) {
          skippedOwned++;
          continue;
        }
      }
      if (best.cardmarket_id == null) continue;
      if (best.cardmarket_id != null) ownedCmIds.add(best.cardmarket_id);
      const cmp = best.prices?.cardmarket ?? {};
      const gEntry = cmGuide.get(best.cardmarket_id);
      const avg = cmp["30d_average"] ?? null;
      const ref = cmGuideRefEur(gEntry) ?? avg; // TREND > 30d — sanitetsreferens OCH fallback
      // FROM (ägarens regel: from > trend > 30-dagssnitt). RapidAPI:s `lowest` FÖRST; saknas
      // den (vanligt på vintage/ETB) tar vi guidens `low` — men BARA när en trend/30d-referens
      // finns att grinda den mot. Utan referens passerar en glitchad guide-From ogranskad
      // (mätt: pin-blister → 2000€, XY Kanto Starters → 22 080 kr). RapidAPI:s egen lowest
      // behåller sitt gamla beteende. Skräp-From fångas annars av sanePriceEur nedan.
      const low = cmp.lowest ?? (ref != null ? usable(gEntry?.low) : null) ?? null;
      // Tunndata-vakt (vintage): ingen engelsk annons alls OCH billigaste annons på
      // NÅGOT språk ligger >3x över 30d-snittet → snittet är internt inkonsistent
      // med marknadens faktiska utbud och går inte att lita på (B&W Booster Box:
      // 1 st DE-annons €7 500 mot "snitt" €890 → headline 9 804 kr på en 130 000 kr-
      // box). Hoppa hellre över än vilseled — priset lämnas orört/null.
      const langLows = [cmp.lowest_DE, cmp.lowest_FR, cmp.lowest_ES, cmp.lowest_IT].filter(
        (v): v is number => typeof v === "number" && v > 0
      );
      if (low == null && avg != null && langLows.length > 0 && Math.min(...langLows) > avg * 3) {
        continue;
      }
      // Referens till sanitetsvakten — OCH det värde vi faller tillbaka på när `lowest`
      // förkastas. CM:s EGEN trend går FÖRE RapidAPI:s 30d_average, av två skäl:
      //   1. 30d_average är null där RapidAPI saknar historik; trenden finns ändå.
      //   2. På tunt handlad vintage är 30d_average kraftigt UNDERSKATTAD. Mätt mot
      //      eBay/PriceCharting-sålt (2026-07-14): Arceus Booster Box → snittet gav
      //      13 498 kr, CM-trenden 32 856 kr, faktisk marknad 33-55k. Flashfire Booster
      //      Box → snittet 24 326 kr, trenden 54 829 kr, marknad 55-105k. Trenden träffar,
      //      snittet missar med 3-4x. Att byta ut ett för HÖGT skräpvärde mot ett för
      //      LÅGT vore ingen rättning — bara ett annat fel.
      let eur = sanePriceEur(low, ref);
      if (eur !== low && low != null) guarded++;

      // HISTORIK-GUARD (ägarens regel-tillägg): när CM-guiden SJÄLV glitchar (Skyridge
      // trend/avg = 1-dagsspiken) är även reservvärdet fel. En PLATT egen historik +
      // ett dagsvärde som avviker >1.5x = glitchen ligger i dagsvärdet → använd historik-
      // medianen. Volatil historik lämnas orörd (äkta marknad). Skyddar OCKSÅ mot en
      // EMPTY-PACKS-From som slank förbi (den ligger långt UNDER den stabila historiken).
      const histOre = stableHistoryOre(p.priceSnapshots.map((s) => s.avgPrice));
      if (eur != null && histOre != null) {
        const eurOre = eur * rates.eurToOre;
        if (Math.max(eurOre / histOre, histOre / eurOre) > 1.5) { eur = histOre / rates.eurToOre; usedHist++; }
      }

      // ── TUNN MARKNAD → INGET PRIS ALLS ────────────────────────────────────
      // Vi accepterade INTE `lowest` (den var skräp/saknades) och måste falla
      // tillbaka på trend/snitt. Det duger bara om marknaden faktiskt handlas.
      // På vintage med en handfull annonser är BÅDA siffrorna fiktion — mätt mot
      // eBay/PriceCharting-sålt 2026-07-14:
      //   Gym Challenge Booster Box  2 annonser, lowest 29 500 € (en placeholder-
      //     annons), 30d-snitt 4 302 € → CM-trenden ger 49 734 kr, verklig marknad
      //     130-250k. Plasma Storm ETB: 1 annons. Supreme Victors: 2. Neo Destiny:
      //     CM-"trend" 99,99 € på en box som gått för 150-450k kr.
      // Ett för lågt påhittat pris är inte bättre än ett för högt — båda bryter mot
      // "inga fabricerade priser". Hellre "–" än en siffra vi vet är fel.
      //
      // Grinden är SMAL med flit, tre villkor:
      //   1. En ACCEPTERAD `lowest` är en riktig, köpbar annons → publiceras alltid,
      //      hur tunn marknaden än är. Bara RESERVVÄRDET misstros.
      //   2. Det måste FINNAS en lowest som vi förkastat (low != null). Det är
      //      placeholder-signaturen: "45 000 € begärt, trend 3 820 €, 4 annonser".
      //      En produkt HELT utan annonser är bara slutsåld på CM — den behåller
      //      sitt gamla beteende (OUT_OF_STOCK + trend som uppskattning).
      //   3. Marknaden är tunn (≤THIN_ITEMS annonser).
      const accepted = low != null && eur === low;
      const items = cmp.available_items ?? 0;
      if (low != null && !accepted && items <= THIN_ITEMS) {
        thinSkipped++;
        sealedOps.push({
          productId: p.id, offerId: cmOffer?.id, priceOre: null, refOre: null,
          url: cardmarketProductUrl(best.cardmarket_id), stock: "UNKNOWN",
        });
        continue;
      }

      const priceOre = eur != null ? Math.round(eur * rates.eurToOre) : null;
      if (priceOre == null) continue; // ingen prisdata alls
      // Glitchad micro-lowest → sanePriceEur gav 30d-snittet; behandla som ur lager
      // (ingen tillförlitlig aktuell annons) istället för att låtsas IN_STOCK.
      const stock = low != null && eur === low ? "IN_STOCK" : "OUT_OF_STOCK";
      // butik-cross-check bara för fuzzy-träffar (exakt cmid = rätt produkt)
      if (!exact && priceOre != null) {
        const storePrices = p.offers.filter((o) => o.retailerId !== cm.id && o.price != null && o.stockStatus === "IN_STOCK").map((o) => o.price as number);
        const storeMin = storePrices.length ? Math.min(...storePrices) : null;
        if (storeMin != null && priceOre > storeMin * 2.5) continue;
      }
      // Self-heal: håll sealed-bilden i synk med CM. Endast på EXAKT cmid-match
      // (fuzzy kan välja fel produkt). Sedan 2026-07-19 sätts CM-PROXYN
      // (/api/cm-image/{cmid}, referer-gated + immutable-cachad) istället för
      // tcggo-hotlinken: då konvergerar ALLA exakt-länkade sealed till CM:s egen
      // bild och gamla tcgplayer-/butiks-/FEL-tcggo-bilder läker automatiskt
      // (Sprigatito/Kanto Friends/Palkia/Riolu-fallen 2026-07-19 var exakt-
      // länkade men behöll fel bild eftersom self-heal bara jämförde tcggo-URL:er).
      // MEN: att katalogen har en bild-URL (best.image) BEVISAR INTE att Cardmarket
      // har en egen render — 325 sealed-SKU:er (blistrar, checklanes, pin-collections)
      // saknar render helt. Det kravet ensamt pekade dem på proxyn, som 404:ade →
      // trasig <img> i hela katalogen (rapporterat 2026-07-21). Proba därför CM:s CDN
      // innan vi byter: finns ingen render vinner katalogens egen bild (tcggo, inte
      // referer-gatead). Probningen körs bara när bilden faktiskt skulle ÄNDRAS, så i
      // stabilt läge kostar den ingenting. En redan satt proxy-URL rörs aldrig.
      const proxyUrl = cmImageProxyUrl(best.cardmarket_id);
      let imageUrl: string | undefined;
      if (exact && best.image && p.imageUrl !== proxyUrl) {
        imageUrl = (await cmRenderExists(best.cardmarket_id))
          ? proxyUrl
          : p.imageUrl === best.image
            ? undefined // redan rätt katalogbild
            : best.image;
      }
      // refOre = CM:s egen trend → dagvaktens nödutgång: ett stort hopp MOT trenden
      // är en rättelse av ett korrupt värde, inte en glitch. Utan den fastnar
      // skräpvärden för alltid (se saneDayMove).
      const refEur = cmGuideRefEur(cmGuide.get(best.cardmarket_id));
      const refOre = refEur != null ? Math.round(refEur * rates.eurToOre) : null;
      sealedOps.push({ productId: p.id, offerId: cmOffer?.id, imageUrl, priceOre, refOre, url: cardmarketProductUrl(best.cardmarket_id), stock });
    }
    const sealed = await clampDayMoves(sealedOps);
    if (sealed.clamped) console.log(`[cm-refresh] Sealed: klämde ${sealed.clamped} orimliga dagshopp (≥${DAY_MOVE_MAX}x) till gårdagens värde.`);
    if (sealed.healed) console.log(`[cm-refresh] Sealed: LÄKTE ${sealed.healed} tidigare korrupta priser (stort hopp mot CM-trend).`);
    await mapPool(sealedOps, DB_CONCURRENCY, async (op) => {
      if (op.imageUrl) await prisma.product.update({ where: { id: op.productId }, data: { imageUrl: op.imageUrl } });
      // Sätt ALLTID price (även null) så ett gammalt uppblåst pris nollas när lowest försvinner.
      if (op.offerId) {
        await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: op.stock, condition: "SEALED", lastSeenAt: new Date() } });
      } else {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "EN" } },
          update: { price: op.priceOre, url: op.url, stockStatus: op.stock, lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: op.stock, url: op.url },
        });
      }
      res.sealedUpdated++;
    });

    // Daglig CM-historikpunkt även för sealed (samma mönster som singlar ovan).
    // Utan detta uppdateras bara Offer.price → sealed-grafen fryser på prod och
    // hänger bara med via manuell synk. Värdet = priset vi visar (lowest/30d).
    const cmSourceSealed = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
    // Bara PRISSATTA ops blir historik. En tunndata-op bär priceOre=null (vi vet inte
    // priset) — den nollar offerens pris men får ALDRIG bli en snapshot-punkt:
    // minPrice/avgPrice är NOT NULL, och en påhittad punkt vore precis det vi undviker.
    const pricedOps = sealedOps.filter(
      (op): op is typeof op & { priceOre: number } => op.priceOre != null,
    );
    if (cmSourceSealed && pricedOps.length > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      await prisma.priceObservation.createMany({
        data: pricedOps.map((op) => ({ productId: op.productId, sourceId: cmSourceSealed.id, price: op.priceOre, currency: "SEK" })),
      });
      await prisma.priceSnapshot.createMany({
        data: pricedOps.map((op) => ({ productId: op.productId, date: today, minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre, volume: 1 })),
        skipDuplicates: true,
      });
      res.historyPoints += pricedOps.length;
    }
    if (guarded) console.log(`[cm-refresh] Prisvakt: ${guarded} glitchade lowest ersatta av CM-referens (trend/30d).`);
    if (usedHist) console.log(`[cm-refresh] Historik-guard: ${usedHist} sealed där CM-guiden glitchade → vår stabila historik-median användes.`);
    if (thinSkipped) console.log(`[cm-refresh] Tunn marknad: ${thinSkipped} sealed utan tillförlitligt pris → "–" (≤${THIN_ITEMS} CM-annonser, reservvärdet går ej att lita på).`);
    if (guideFallback) console.log(`[cm-refresh] EN-guide-fallback: ${guideFallback} sealed vars idProduct saknas i RapidAPI prissatta direkt från CM-guiden (annars frusna).`);
    console.log(`[cm-refresh] Sealed: ${res.sealedUpdated} uppdaterade, ${pricedOps.length} historikpunkter.`);
    if (skippedOwned > 0) {
      console.log(
        `[cm-refresh] Sealed: hoppade över ${skippedOwned} fuzzy-matchningar mot en CM-produkt som redan ` +
          `ägs av en annan katalogprodukt (unikhetsvakt — en produkt utan graf är bättre än en med FEL graf).`
      );
    }
  }

  // Japanska sealed-produkter: officiella CM-prisguiden (gratis nedladdning,
  // ingen RapidAPI-kvot). Egna JP-produktsidor på CM + language=7-länkar.
  if (opts.sealed !== false) {
    try {
      const jp = await runJapaneseSealedRefresh();
      res.historyPoints += jp.updated;
    } catch (err) {
      console.error("[cm-refresh] JP-refresh misslyckades:", err instanceof Error ? err.message : err);
    }
  }

  // Specialvariant-priser (GameStop-promo, reverse m.m.) via pokemontcg.io-trend.
  res.historyPoints += await runVariantRefresh();

  // Uppdatera denormaliserat lägstapris (katalog-feed: sortering + gömning).
  await recomputeProductPriceCache();
  // Daglig historikpunkt för sealed UTAN CM-trend (butiksprissatta) — annars
  // fryser deras graf. Kör SIST: CM-mappade har redan snapshot, lowestPriceOre färskt.
  const storeSnaps = await snapshotStorePricedProducts();
  if (storeSnaps > 0) console.log(`[cm-refresh] Butikshistorik: ${storeSnaps} snapshots (sealed utan CM-trend).`);
  console.log(`[cm-refresh] Klart: ${res.apiCalls} API-anrop, kvot kvar ${res.remaining}.`);
  return res;
}
