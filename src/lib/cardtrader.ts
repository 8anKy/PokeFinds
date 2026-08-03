/**
 * CARDTRADER — EGEN MARKNADSPLATS, EGEN PRISKÄLLA.
 *
 * CardTrader (Gray Fox SRL, Italien) är den enda öppna dörren till priser som är
 * uppdelade PER TRYCKNING: `pokemon_reverse` och `first_edition` sitter på
 * ANNONSEN, inte på produkten. Cardmarkets guide är keyad på `idProduct` och kan
 * per konstruktion aldrig göra det ([[project_tcg_cardmarket_api_rejected]]).
 *
 * ⛔ DETTA ÄR INTE CARDMARKET. Talet härifrån får ALDRIG blandas in i, jämföras
 * bort mot eller publiceras under rubriken `lowest_near_mint` — se
 * "GOLVET RAKT AV" i CLAUDE.md. CardTrader blir en EGEN `Offer` med EGEN länk
 * som konkurrerar i billigast-vinner precis som Tradera och butikerna, och
 * rubriken namnger källan (`lowestOfferSource`).
 *
 * MODULEN ÄR DELAD I TVÅ:
 *  - REN LOGIK (urval, parsning, nyckelbygge) — testad utan nätverk längst upp.
 *  - NÄTVERK — tunt skal längst ner.
 * Skälet är samma som `print-variant.ts`: urvalsregeln är det som avgör om ett
 * pris är sant, och en regel som bara går att köra mot ett levande API blir
 * aldrig mätt mot facit.
 *
 * MÄTT 2026-08-02 mot Paldea Evolved (expansion 3316):
 *  - `fixed_properties.collector_number` är ENTYDIG: 286 unika av 287 blueprints.
 *    Enda krocken är Orthworm 151 (Holo Rare + Non-Holo = två CM-produkter).
 *  - `version` är INTE ett nummerfält: "Holo Rare | 151/193", "Ultra Rare |
 *    005/193", ibland bara "106/193". Använd collector_number, inte version.
 *  - Promo-varianter får suffix: Annihilape ex Box-Primeape är "107h", vilket
 *    är precis varför de INTE krockar med huvudsetets "107".
 *  - `card_market_ids` har längd 1 på alla 287 singlar ⇒ exakt join mot vårt
 *    `idProduct` när vi vill korsvalidera.
 */

import { VARIANT_MASTER_BALL, VARIANT_POKE_BALL, VARIANT_REVERSE_HOLO } from "./print-variant";

/** Pokémon i CardTraders speltabell (`/games`). */
export const CT_GAME_POKEMON = 5;

/**
 * Etiketten reverse holo-produkterna bär (`Product.variantLabel`).
 *
 * Bor HÄR och inte i jobbet därför att `cardmarket-refresh` måste kunna UNDANTA
 * den utan att dra in en andra PrismaClient — och därför att en etikett som
 * stavas på två ställen förr eller senare stavas olika. Värdet fanns redan i
 * katalogen (en produkt) innan importen byggdes; det återanvänds med flit.
 */
export const CT_REVERSE_LABEL = VARIANT_REVERSE_HOLO;

export interface CtExpansion {
  id: number;
  game_id: number;
  code: string;
  name: string;
}

export interface CtBlueprint {
  id: number;
  name: string;
  version: string | null;
  game_id: number;
  category_id: number;
  expansion_id: number;
  fixed_properties: {
    collector_number?: string;
    pokemon_rarity?: string;
    [k: string]: unknown;
  };
  editable_properties: Array<{ name: string; possible_values?: unknown }>;
  card_market_ids: number[] | null;
  tcg_player_id: number | null;
  image_url: string | null;
}

export interface CtListing {
  id: number;
  blueprint_id: number;
  name_en: string;
  expansion: { id: number; code: string; name_en: string };
  quantity: number;
  graded: boolean;
  on_vacation: boolean;
  price: { cents: number; currency: string };
  properties_hash: {
    condition?: string;
    pokemon_language?: string;
    pokemon_reverse?: boolean;
    first_edition?: boolean;
    signed?: boolean;
    altered?: boolean;
    sealed?: boolean;
    collector_number?: string;
    [k: string]: unknown;
  };
}

/** `/marketplace/products` svarar som en karta blueprint_id → annonser. */
export type CtMarketplace = Record<string, CtListing[]>;

// ---------------------------------------------------------------- ren logik

/**
 * Skicken vi räknar som "NM eller bättre" — SAMMA avgränsning som Cardmarket-
 * länkarnas `minCondition=2` (`withNearMint`). Att de två källorna svarar på
 * samma fråga är hela poängen med att de får konkurrera om samma rubrikrad.
 */
export const CT_NM_CONDITIONS = new Set(["Mint", "Near Mint"]);

/**
 * Är annonsen ett pris vi får publicera?
 *
 * Varje villkor är ett eget påstående, och de är avsiktligt STRIKTA: en annons
 * som INTE bär `pokemon_reverse: true` är inte "kanske reverse", den är ett
 * annat kort. Samma sak för språket — `undefined` är inte "en".
 *
 * `on_vacation` och `quantity` är inte kosmetika: en semestrande säljares annons
 * går inte att köpa, och ett golv byggt på en okköpbar annons är exakt den sorts
 * påstående rubriken inte får göra.
 */
export function isBuyableNmEnListing(l: CtListing): boolean {
  const p = l.properties_hash ?? {};
  return (
    p.pokemon_language === "en" &&
    typeof p.condition === "string" &&
    CT_NM_CONDITIONS.has(p.condition) &&
    l.graded !== true &&
    p.signed !== true &&
    p.altered !== true &&
    p.sealed !== true &&
    l.on_vacation !== true &&
    (l.quantity ?? 0) > 0 &&
    l.price?.currency === "EUR" &&
    Number.isFinite(l.price?.cents) &&
    l.price.cents > 0
  );
}

export function isPublishableReverseListing(l: CtListing): boolean {
  return isBuyableNmEnListing(l) && l.properties_hash?.pokemon_reverse === true;
}

/**
 * Samma annons fast för den ORDINARIE tryckningen. Används BARA som referens åt
 * rimlighetsvakten, aldrig som publicerat pris (det talet äger Cardmarket).
 * `undefined` och `false` betyder båda "inte reverse".
 */
export function isNonReverseNmEnListing(l: CtListing): boolean {
  return isBuyableNmEnListing(l) && l.properties_hash?.pokemon_reverse !== true;
}

export interface ReversePrice {
  /** Lägsta publicerbara annonsen, i eurocent. */
  cents: number;
  /** Hur många annonser golvet valdes UR — vårt mått på hur tunt underlaget är. */
  depth: number;
  listingId: number;
}

/**
 * Lägsta NM-engelska reverse holo-annonsen, eller null.
 *
 * RÅ, OVAKTAD. Den här funktionen svarar bara på "vad är billigast?" —
 * rimlighetsbedömningen ligger i `judgeReversePrice`, som är den enda vägen
 * till ett PUBLICERAT pris. Uppdelningen är med flit: revisionsskriptet vill se
 * det ovaktade talet för att kunna mäta vad vakten faktiskt stoppar.
 */
export function cheapestReverseNmEn(
  listings: CtListing[] | undefined,
  minDepth = 1
): ReversePrice | null {
  const ok = (listings ?? []).filter(isPublishableReverseListing);
  if (ok.length < minDepth || ok.length === 0) return null;
  const best = ok.reduce((a, b) => (b.price.cents < a.price.cents ? b : a));
  return { cents: best.price.cents, depth: ok.length, listingId: best.id };
}

/** Lägsta NM-engelska ORDINARIE annonsen — vaktens referens, aldrig ett pris. */
export function cheapestNonReverseNmEn(listings: CtListing[] | undefined): number | null {
  const ok = (listings ?? []).filter(isNonReverseNmEnListing);
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.price.cents < a.price.cents ? b : a)).price.cents;
}

/**
 * Minsta antal annonser bakom ett publicerat golv. MÄTT: av 223 orimliga golv
 * (≥1 000 kr) hade 194 exakt EN annons bakom sig.
 */
export const CT_MIN_DEPTH = 2;

/**
 * Hur många gånger kortets ORDINARIE pris en reverse holo som mest får kosta.
 *
 * Äkta reverse holos ligger typiskt på 0,5–5× det ordinarie kortet (mätt i
 * Paldea Evolved: Primeape normal 0,11 € mot reverse 0,27 €). 50 är alltså
 * ~10× utanför normal variation — vakten kan inte fälla ett äkta prishopp,
 * bara absurditeter.
 */
export const CT_MAX_REVERSE_RATIO = 50;

export type ReverseReject = "thin" | "implausible" | "none";

export interface ReverseVerdict {
  /** Publicerbart pris, eller null om vakten sa nej. */
  price: ReversePrice | null;
  reason: ReverseReject;
  /** Referenspriset vakten dömde mot (eurocent), om något fanns. */
  referenceCents: number | null;
  ratio: number | null;
}

/**
 * DEN ENDA VÄGEN TILL ETT PUBLICERAT REVERSE-PRIS.
 *
 * Två spärrar, båda mätta mot facit innan de skeppades:
 *
 * 1. **DJUP** (`CT_MIN_DEPTH`). Ett golv som vilar på en enda annons är inte ett
 *    marknadspris, det är en åsikt. 194 av 223 orimliga golv hade djup 1.
 *
 * 2. **KVOT MOT KORTETS ORDINARIE PRIS**. Djupet ensamt RÄCKER INTE — mätt:
 *    Temporal Forces 141 Awakening Drum (9,9 M€) och Black & White 33 Panpour
 *    (21 988 €) har BÅDA två annonser, och båda är skräp. Säljare parkerar kort
 *    på exakt 10 000,00 € när de inte vill sälja; talet återkom identiskt över
 *    hela katalogen.
 *
 * ⚠️ VARFÖR DET HÄR INTE ÄR EN FJÄRDE GUIDE-VAKT (CLAUDE.md river tre stycken):
 * de rivna vakterna dömde Cardmarkets From mot Cardmarkets GUIDE — ett tal av
 * ANNAN kvalitet som påstods binda samma sak, och som visade sig vara 12× fel.
 * Här jämförs CardTraders reverse-golv mot CardTraders EGET ordinarie golv:
 * samma marknadsplats, samma säljare, samma valuta, samma NM/engelska-filter.
 * Referensen är dessutom ENSIDIG (bara tak, aldrig golv) och satt så högt att
 * den inte kan bli en spärrhake — den avvisar, den ERSÄTTER aldrig ett tal.
 *
 * `referenceCents` får skickas in när CardTrader saknar ordinarie annonser
 * (då duger vårt eget publicerade baspris). Finns INGEN referens alls faller vi
 * tillbaka på enbart djupkravet: hellre ett vaktat-så-långt-det-går pris än
 * inget pris för hela svansen.
 */
export function judgeReversePrice(
  listings: CtListing[] | undefined,
  opts: { fallbackReferenceCents?: number | null; minDepth?: number; maxRatio?: number } = {}
): ReverseVerdict {
  const minDepth = opts.minDepth ?? CT_MIN_DEPTH;
  const maxRatio = opts.maxRatio ?? CT_MAX_REVERSE_RATIO;

  const raw = cheapestReverseNmEn(listings, 1);
  if (!raw) return { price: null, reason: "none", referenceCents: null, ratio: null };
  if (raw.depth < minDepth) {
    return { price: null, reason: "thin", referenceCents: null, ratio: null };
  }

  // CardTraders eget ordinarie golv först — samma källa är den bästa referensen.
  const reference = cheapestNonReverseNmEn(listings) ?? opts.fallbackReferenceCents ?? null;
  if (reference == null || reference <= 0) {
    return { price: raw, reason: "none", referenceCents: null, ratio: null };
  }
  const ratio = raw.cents / reference;
  if (ratio > maxRatio) {
    return { price: null, reason: "implausible", referenceCents: reference, ratio };
  }
  return { price: raw, reason: "none", referenceCents: reference, ratio };
}

/**
 * Blueprintens samlarnummer, normaliserat till vår katalogs skrivsätt.
 *
 * CardTrader skriver "106", "007", och för promo-varianter "107h". Vår katalog
 * skriver "106", "7", "TG07". Nyckeln nollställs därför inte till ett TAL —
 * `parseInt` hade gjort "TG07" till NaN och slagit ihop "107h" med "107", vilket
 * är precis den sortens tysta hopslagning som prissätter fel kort.
 *
 * ⛔ TOTALEN MÅSTE STRIPPAS, OCH DET ÄR INTE KOSMETIKA. CardTrader skriver
 * numret på TVÅ sätt beroende på hur gammal expansionen är: moderna set ger
 * "106", äldre ger **"001/149"**. MÄTT innan regeln fanns: Sun & Moon 173 av
 * 173 kort, Steam Siege 116 av 116 och Vivid Voltage 189 av 203 föll ur
 * matchningen helt — dvs precis de äldre seten, som är de enda där reverse
 * holos är värda något (Team Up median 51 kr mot Paldea Evolveds 2 kr).
 * Bortfallet var TYST: ett kort utan blueprint ser likadant ut som ett kort
 * utan annonser.
 */
export function ctNumberKey(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  // "001/149" → "001". Bara när HELA svansen är en ren total, så att ett
  // nummer som verkligen innehåller snedstreck inte tyst stympas.
  const withTotal = s.match(/^(.+?)\/\d+$/);
  if (withTotal) s = withTotal[1];
  // Ledande nollor bort, men BARA från en ren sifferdel: "007" → "7", "107h" → "107h".
  const m = s.match(/^0*(\d+)$/);
  if (m) return m[1];
  return s;
}

/** Är blueprinten en SINGEL (och inte en sealed-produkt)? */
export function isSingleBlueprint(b: CtBlueprint): boolean {
  return typeof b.fixed_properties?.collector_number === "string";
}

/**
 * Kan blueprinten över huvud taget bära en reverse holo enligt CardTrader?
 * `pokemon_reverse` står bland `editable_properties` bara för kort där varianten
 * finns. Det är CardTraders EGEN taxonomi och används som en billig försiktighets-
 * signal — den ersätter INTE TCGdex `variants.reverse`, som är vår grind.
 */
export function blueprintAllowsReverse(b: CtBlueprint): boolean {
  return (b.editable_properties ?? []).some((p) => p.name === "pokemon_reverse");
}

/**
 * Så många KORT måste setet ha — utan ett enda `reverse: true` — innan dess
 * taxonomi bedöms OANVÄNDBAR i stället för reverse-lös. Ett litet promoset som
 * säger nej säger förmodligen sanningen.
 */
export const DEX_DISTRUST_MIN = 20;

/**
 * Är TCGdex reverse-data för det HÄR setet obrukbart?
 *
 * ⛔ "SÄGER NEJ" OCH "HAR INTE FYLLT I" SER LIKADANA UT PÅ KORTNIVÅ. MÄTT
 * 2026-08-03: Chaos Rising (me04) har `reverse: false` på VARENDA kort, medan
 * grannseten Perfect Order (me03) och Pitch Black (me05) har `true` på de flesta.
 * Chaos Rising är ett modernt huvudset och CardTrader har 76 kort med riktiga
 * NM-engelska reverse-annonser — datat är alltså ofyllt, inte negativt. Utan den
 * här regeln tappade grinden ett helt set TYST.
 *
 * ⛔ BEVISET ÄR SETETS STORLEK, INTE HUR MÅNGA KANDIDATER MARKNADEN RÅKADE GE.
 * Första versionen räknade `dexYes`/`dexNo` över de kort som ÖVERLEVT
 * djupvakten — alltså ett urval styrt av CardTraders lagerdjup, som inte har
 * någonting med TCGdex datakvalitet att göra. MÄTT i produktion 2026-08-03:
 * EX Team Rocket Returns hade 9 kandidater, EX Deoxys 13, EX Emerald 18, alla
 * under tröskeln 20 ⇒ misstron fyrade aldrig, TCGdex nej togs för sanning och
 * **hela set fick NOLL reverse-produkter** — medan EX FireRed & LeafGreen (27
 * kandidater) råkade komma över och fick 23. Två grannset ur samma era, olika
 * utfall, av ett skäl som inte har med korten att göra.
 *
 * Två oberoende fel hos TCGdex ger samma symtom, och båda täcks av regeln nedan:
 *  · **Felmärkning** — hela EX-eran bär reverse holon under flaggan `holo`
 *    (ex7: 0 `reverse`, 111 `holo` av 111 kort). Facit: pokemontcg.io prissätter
 *    exakt `normal` + `reverseHolofoil` för dem, ingen `holofoil`.
 *  · **Ofyllt** — Legendary Treasures och Call of Legends har VARKEN `reverse`
 *    eller `holo` på ett enda kort, fast båda seten självklart har reverse holos.
 *
 * `setReverseCount > 0` bevisar att setet är ifyllt, och då betyder ett nej nej.
 */
export function shouldDistrustDexTaxonomy(
  setReverseCount: number,
  setCardCount: number,
  min = DEX_DISTRUST_MIN
): boolean {
  return setReverseCount === 0 && setCardCount >= min;
}

/**
 * Hur långt UNDER vårt publicerade pris ett CardTrader-golv får ligga innan det
 * behandlas som en felmatchning i stället för ett fynd.
 *
 * ⛔ RIKTNINGEN ÄR MÄTT, INTE GISSAD. CardTrader är den DYRARE marknadsplatsen:
 * över 17 710 ordinarie kort är medianen `ct / vårt pris` = **3,67**, p75 = 5,5 och
 * p95 = 13. Att ligga högt är alltså normaltillståndet. Att ligga långt UNDER är
 * det inte — bara 0,5 % (83 kort) hamnar under en femtedel, och de bär
 * felmatchningens signatur: Raikou · Secret Wonders 16/132 publicerat till
 * 13 775 kr mot ett CardTrader-golv på 199 kr (69×), Giratina-EX · Dragons Exalted
 * 3 656 kr mot 334 kr.
 *
 * ⚠️ Det här är INTE "döm identitet på prisavstånd" (den regel som fällde fel kort
 * i cardmarket-refresh). Vi kastar ingen rad och ändrar inget pris — vi avstår
 * bara från att PUBLICERA en andra källas tal som motsäger den första med en
 * faktor som marknaden inte förklarar.
 */
export const CT_MIN_BASE_RATIO = 0.2;

/** Är CardTraders ordinarie golv publicerbart bredvid vårt nuvarande pris? */
export function isPlausibleBaseFloor(
  cents: number,
  referenceCents: number | null,
  minRatio = CT_MIN_BASE_RATIO
): boolean {
  if (referenceCents == null || referenceCents <= 0) return true;
  return cents >= referenceCents * minRatio;
}

/** Produktsidan hos CardTrader för en blueprint. */
export function ctBlueprintUrl(blueprintId: number): string {
  return `https://www.cardtrader.com/cards/${blueprintId}`;
}

/**
 * Setnamn → jämförbar nyckel. Diakriter och skiljetecken bort ("Pokémon GO" och
 * "Pokemon GO" är samma set), &/and normaliserat.
 */
export function ctSetNameKey(s: string): string {
  return s
    .normalize("NFD")
    // Kombinerande diakriter som ESCAPES, inte som literala tecken: de senare är
    // osynliga i en diff och överlever inte en slarvig filkopiering.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * VÅRT setnamn → de namn CardTrader kan tänkas använda, i fallande säkerhet.
 *
 * ⛔ INGEN FUZZY-MATCHNING. Kandidaterna är EXAKTA strängar som måste träffa en
 * expansion rakt av. Skälet är mätt: "Arceus" liknar både "Platinum Arceus"
 * (rätt) och "Advent of Arceus", "Arceus LV.X Deck: Lightning & Psychic" (fel),
 * och "Dragon" liknar "EX Dragon", "Dragon Vault" och "Dragon Majesty lika
 * mycket. En poängtröskel hade valt bland dem; en exakt kandidat kan bara träffa
 * rätt eller inte alls. Samma hållning som `cmCardNameAgrees` i
 * cardmarket-refresh: vid oenighet prissätts INGET.
 *
 * PREFIXREGLERNA ÄR GRINDADE PÅ VÅR EGEN `series` — inte på gissning. Hela
 * EX-eran heter "EX <namn>" hos CardTrader medan vår katalog (pokemontcg.io)
 * skriver namnet utan prefix; att sätta "EX " på ett set ur en annan serie hade
 * kunnat träffa ett helt annat set.
 */
export function ctExpansionCandidates(setName: string, series: string | null): string[] {
  const out: string[] = [setName];
  const s = series ?? "";

  // HeartGold & SoulSilver: vår katalog skriver "HS—Triumphant", CT "Triumphant".
  const hs = setName.replace(/^HS[—\-–]\s*/u, "");
  if (hs !== setName) out.push(hs);

  // EX-eran: "Deoxys" → "EX Deoxys". Bara för set som ÄR ur EX-serien.
  if (s === "EX" && !/^EX\s/i.test(setName)) out.push(`EX ${setName}`);
  if (s === "Platinum" && !/^Platinum\s/i.test(setName)) out.push(`Platinum ${setName}`);
  if (s === "XY" && !/^XY\s/i.test(setName)) out.push(`XY ${setName}`);

  // Base: vår "Base" är CT:s "Base Set" (Shadowless är en EGEN expansion, 1969).
  if (setName === "Base") out.push("Base Set");

  // Promos: "… Black Star Promos" heter bara "… Promos" hos CardTrader.
  const promo = setName.replace(/\bBlack Star Promos\b/, "Promos");
  if (promo !== setName) out.push(promo);

  return out;
}

/**
 * SPECIALMÖNSTRADE REVERSE HOLOS — Master Ball och Poké Ball.
 *
 * ⛔ CardTrader modellerar dem som EGNA EXPANSIONER, inte som en egenskap på
 * annonsen: "Prismatic Evolutions - Master Ball Reverse Holo" är en expansion
 * vid sidan av "Prismatic Evolutions". Därför ser den vanliga importen dem inte
 * alls — den mappar vårt set till EN expansion och slutar där. MÄTT 2026-08-03:
 * 418 kort med djup ≥2 i NM-engelska annonser ligger bakom de här expansionerna,
 * med Umbreon · Prismatic Evolutions Master Ball på 80,64 € (~930 kr).
 *
 * Matchningen är EXAKT på formen `<vårt setnamn> - <bollnamn> Reverse Holo`, av
 * samma skäl som `matchExpansion` är exakt: "151" och "Collect 151" liknar
 * varandra, och de japanska motsvarigheterna (sv2a, sv8a, sv11W/B) bär nästan
 * identiska namn. En kandidat kan bara träffa rätt eller inte alls.
 */
export const BALL_EXPANSION_SUFFIXES: { label: string; pattern: RegExp }[] = [
  { label: VARIANT_MASTER_BALL, pattern: /^master ball reverse holo$/ },
  { label: VARIANT_POKE_BALL, pattern: /^pok[eé]? ?ball reverse holo$/ },
];

export interface BallExpansion {
  label: string;
  expansion: CtExpansion;
}

/** Setets boll-expansioner hos CardTrader (0–2 st). */
export function matchBallExpansions(
  setName: string,
  expansions: CtExpansion[]
): BallExpansion[] {
  const setKey = ctSetNameKey(setName);
  const out: BallExpansion[] = [];
  for (const { label, pattern } of BALL_EXPANSION_SUFFIXES) {
    const hits = expansions.filter((e) => {
      const idx = e.name.lastIndexOf(" - ");
      if (idx < 0) return false;
      if (ctSetNameKey(e.name.slice(0, idx)) !== setKey) return false;
      return pattern.test(ctSetNameKey(e.name.slice(idx + 3)));
    });
    if (hits.length === 1) out.push({ label, expansion: hits[0] });
  }
  return out;
}

/**
 * Slår vårt set mot CardTraders expansionslista. Returnerar bara ENTYDIGA
 * träffar — två expansioner med samma normaliserade namn ger null, aldrig ett
 * mynt-kast.
 */
export function matchExpansion(
  setName: string,
  series: string | null,
  expansions: CtExpansion[]
): CtExpansion | null {
  const byKey = new Map<string, CtExpansion[]>();
  for (const e of expansions) {
    const k = ctSetNameKey(e.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(e);
  }
  for (const cand of ctExpansionCandidates(setName, series)) {
    const hits = byKey.get(ctSetNameKey(cand));
    if (hits?.length === 1) return hits[0];
  }
  return null;
}

// ------------------------------------------------------------------ nätverk

const BASE = "https://api.cardtrader.com/api/v2";

export class CardTraderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CardTraderError";
  }
}

function token(): string {
  const t = process.env.CARDTRADER_TOKEN;
  if (!t) throw new Error("CARDTRADER_TOKEN saknas i miljön");
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ett GET mot CardTrader med backoff.
 *
 * De skickar INGA rate-limit-headers (mätt), så vi kan inte läsa oss till taket
 * — bara backa av när det säger ifrån. `minGapMs` seriellt mellan anrop håller
 * oss långt under; hela katalogen är ~170 expansionsanrop, inte tusentals.
 */
export async function ctGet<T>(path: string, retries = 4): Promise<T> {
  let wait = 1500;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" },
    });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new CardTraderError(
        `CardTrader ${res.status} på ${path}: ${(await res.text()).slice(0, 200)}`,
        res.status
      );
    }
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : wait);
    wait = Math.min(wait * 2, 30_000);
  }
}

export async function ctExpansions(): Promise<CtExpansion[]> {
  const all = await ctGet<CtExpansion[]>("/expansions");
  return all.filter((e) => e.game_id === CT_GAME_POKEMON);
}

export async function ctBlueprints(expansionId: number): Promise<CtBlueprint[]> {
  return ctGet<CtBlueprint[]>(`/blueprints/export?expansion_id=${expansionId}`);
}

export async function ctMarketplace(expansionId: number): Promise<CtMarketplace> {
  return ctGet<CtMarketplace>(`/marketplace/products?expansion_id=${expansionId}`);
}
