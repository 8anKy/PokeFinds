/**
 * "Bäst matchning" — katalogens standardordning och sökrelevans.
 *
 * FORMEN ÄR DEN VANLIGA (eBay Best Match, Etsy, A9): hämta kandidater → poängsätt
 * på RELEVANS × KVALITET → efterjustera personligt. Skillnaden mot dem är att de
 * lär vikterna ur miljontals klick. MÄTT I VÅR PROD 2026-07-29: 4 användare,
 * 8 sök-klick och 754 produktvisningar på 30 dygn, 615 av 22 457 produkter med
 * någon händelse alls. Det räcker inte till en inlärd modell — den hade anpassat
 * sig till brus. Vikterna här är därför HANDSATTA och förklarliga, och hela
 * poängsättningen är rena funktioner (inget DB-beroende) så den går att testa och
 * att köra både i det dagliga jobbet och i minnet under en sökning.
 *
 * Poängen ÄR INTE ett filter: den ordnar bara den träffmängd som filtren redan
 * släppt igenom. En produkt kan aldrig rankas IN i ett resultat den inte matchar.
 */
import { normalizeTitle } from "@/lib/utils";

/* ─────────────────────────── Kvalitet (produktens egen) ─────────────────────── */

export interface QualityInput {
  /** Viktad engagemangsvolym senaste 30 dygnen (Product.viewCount, fylls av refreshPopularityScores). */
  engagement30d: number;
  /** Antal bevakare. */
  watchers: number;
  /** Antal offers med lagerstatus IN_STOCK (direkt länk — samma vakt som resten av katalogen). */
  inStockCount: number;
  /** Antal offers totalt (butiksbredd). */
  offerCount: number;
  hasImage: boolean;
  /** Finns ett publicerat pris alls (null = gömd/uppskattad). */
  hasPrice: boolean;
  /** Setets releasedatum — nya set är det folk handlar. */
  setReleaseDate: Date | null;
  now?: Date;
}

/** Engagemang ~50 poäng räknas som "full pott" — därutöver planar kurvan ut. */
const ENGAGEMENT_CEILING = 50;
/** Bevakare: 10 stycken = full pott (katalogen har få användare; taket får inte vara högt). */
const WATCHER_CEILING = 10;
/** Butiksbredd: fler än fyra butiker tillför inget mer. */
const RETAILER_CEILING = 4;
/** Färskhet: ett set äldre än tre år ger ingen bonus alls. */
const RECENCY_DAYS = 1095;
const DAY_MS = 24 * 3600 * 1000;

const damp = (value: number, ceiling: number): number =>
  value <= 0 ? 0 : Math.min(1, Math.log1p(value) / Math.log1p(ceiling));

/**
 * 0..~1.7. Vad som gör en produkt värd att visa FÖRST när ingen sökt på något:
 * folk tittar på den, folk bevakar den, den GÅR ATT KÖPA nu, och posten är hel
 * (bild + pris). En slutsåld post med uppskattat värde är inte fel — men den ska
 * inte inleda katalogen.
 */
export function qualityScore(i: QualityInput): number {
  const now = i.now ?? new Date();
  const ageDays = i.setReleaseDate
    ? (now.getTime() - i.setReleaseDate.getTime()) / DAY_MS
    : RECENCY_DAYS;
  const recency = Math.max(0, 1 - Math.max(0, ageDays) / RECENCY_DAYS);

  const score =
    1 +
    0.2 * damp(i.engagement30d, ENGAGEMENT_CEILING) +
    0.15 * damp(i.watchers, WATCHER_CEILING) +
    0.15 * (i.inStockCount > 0 ? 1 : 0) +
    0.05 * Math.min(i.offerCount, RETAILER_CEILING) / RETAILER_CEILING +
    0.05 * (i.hasImage ? 1 : 0) +
    0.1 * recency -
    0.2 * (i.hasPrice ? 0 : 1);
  return Math.max(0, score);
}

/** Heltalsformen som lagras i `Product.rankScore` (DB-sorterbar utan flyttal). */
export function qualityScoreInt(i: QualityInput): number {
  return Math.round(qualityScore(i) * 1000);
}

/* ─────────────────────────────── Relevans (sökordet) ────────────────────────── */

export interface RelevanceInput {
  /** Användarens sökord, obehandlat. */
  query: string;
  title: string;
  cardName: string | null;
  cardNumber: string | null;
  setName: string | null;
}

/** "4/102", "115a", "042" → jämförbar nyckel (samma anda som cardNumberKey i matching.ts). */
const numberKey = (s: string): string => s.toLowerCase().replace(/^0+(?=\d)/, "").split("/")[0];

/**
 * 0..~10. Ju högre desto bättre svarar produkten på just DE HÄR orden.
 *
 * ⛔ SETNAMNET ÄR EN FÄLLA, inte en träff: setnamn är delsträngar av varandra och av
 * vanliga kortnamn ("Base" finns i varje Secret Base-kort, "151" i varje kort med det
 * numret). En produkt vars ENDA koppling till sökordet är setnamnet trycks därför ned,
 * precis som setfiltret slutade lita på titeltext (se buildProductWhere).
 */
export function relevanceScore(i: RelevanceInput): number {
  const q = normalizeTitle(i.query);
  if (!q) return 0;
  const title = normalizeTitle(i.title);
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  const card = i.cardName ? normalizeTitle(i.cardName) : "";
  const setName = i.setName ? normalizeTitle(i.setName) : "";

  let score = 0;

  // Kortnummer-orden först: "004" och "4/102" är SAMMA nummer som kortets "4", men
  // ingen av dem står så i titeltexten. Utan det här räknades "charizard 004" som en
  // sämre täckning än "charizard 4" fast båda pekar ut exakt samma kort.
  const numberWords = new Set<string>();
  if (i.cardNumber) {
    const key = numberKey(i.cardNumber);
    for (const w of words) if (/\d/.test(w) && numberKey(w) === key) numberWords.add(w);
  }

  // 1. Hela frågan är titeln / kortnamnet. Det starkaste svaret som finns.
  if (title === q) score += 4;
  else if (title.startsWith(`${q} `) || title.startsWith(`${q}:`)) score += 2;
  if (card && card === q) score += 1.5;
  else if (card && card.startsWith(`${q} `)) score += 0.75;

  // 2. Hur stor del av orden som alls finns i titeln (det filtret redan krävt —
  //    men fuzzy-reserven kan släppa in rader som bara matchar delvis).
  const inTitle = words.filter((w) => title.includes(w) || numberWords.has(w)).length;
  score += (inTitle / words.length) * 1.0;

  // 3. Ord som träffar KORTNAMNET väger tyngre än ord som bara finns i titeln:
  //    "charizard" ska ge Charizard-kortet, inte varje ask som råkar nämna det.
  if (card) {
    const inCard = words.filter((w) => card.includes(w)).length;
    score += (inCard / words.length) * 1.25;
  }

  // 4. Kortnummer i frågan ("charizard 4/102", "sv 187").
  if (numberWords.size > 0) score += 1.2;

  // 5. Setnamns-fällan: matchar frågan BARA setnamnet (varken titel- eller kortord)
  //    är det nästan alltid en felträff.
  if (setName) {
    const onlySet =
      inTitle === 0 && words.some((w) => setName.includes(w));
    if (onlySet) score -= 0.5;
  }

  return Math.max(0, score);
}

/* ───────────────────────────── Personligt (dina egna data) ──────────────────── */

/**
 * Personaliseringen använder BARA data du själv lagt in: bevakningar och samling.
 * Ingen ny spårning, inget beteendelager per användare — `analytics.ts` strippar
 * med flit userId ur varje händelse, och det ska den fortsätta göra.
 */
export interface PersonalContext {
  watchedProductIds: Set<string>;
  ownedProductIds: Set<string>;
  /** Set du redan bevakar eller samlar på → dess produkter är mer relevanta för dig. */
  affinitySetIds: Set<string>;
}

export interface PersonalTarget {
  id: string;
  setId: string | null;
}

/** 0..~0.75 — läggs till efter relevans×kvalitet, aldrig som ett filter. */
export function personalBoost(item: PersonalTarget, ctx: PersonalContext): number {
  let boost = 0;
  if (ctx.watchedProductIds.has(item.id)) boost += 0.35;
  if (ctx.ownedProductIds.has(item.id)) boost += 0.15;
  if (item.setId && ctx.affinitySetIds.has(item.setId)) boost += 0.25;
  return boost;
}

export const EMPTY_PERSONAL: PersonalContext = {
  watchedProductIds: new Set(),
  ownedProductIds: new Set(),
  affinitySetIds: new Set(),
};

/* ─────────────────────────────── Sammanvägningen ────────────────────────────── */

export interface BestMatchItem extends PersonalTarget {
  title: string;
  cardName: string | null;
  cardNumber: string | null;
  setName: string | null;
  quality: QualityInput;
}

/**
 * Utan sökord: ren kvalitet (+ personligt). Med sökord: relevans × kvalitet, så att
 * en medioker post som svarar EXAKT på frågan slår en populär post som knappt gör det.
 */
export function bestMatchScore(
  item: BestMatchItem,
  opts: { query?: string; personal?: PersonalContext } = {}
): number {
  const quality = qualityScore(item.quality);
  const q = opts.query?.trim();
  const base = q
    ? relevanceScore({
        query: q,
        title: item.title,
        cardName: item.cardName,
        cardNumber: item.cardNumber,
        setName: item.setName,
      }) * quality
    : quality;
  return base + personalBoost(item, opts.personal ?? EMPTY_PERSONAL);
}
