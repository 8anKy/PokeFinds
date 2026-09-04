/**
 * GRADERADE ANNONSER — igenkänning och normalisering.
 *
 * Två jobb, med olika krav på precision:
 *
 *  1. `isGradedListing()` — VAKTEN. Får en annons bli en prispunkt på en RAW
 *     produkt? Ett graderat kort är en ANNAN vara än det ograderade kortet: en
 *     PSA 10 Charizard och en lös Charizard delar namn men inte pris. Mätt
 *     2026-09-04: 16 aktiva offers och 591 prisobservationer i produktionen låg
 *     på RAW produkter men var graderade kort — bl.a. en CGC 6 för 30 000 kr som
 *     "lägsta pris" på ett löskort.
 *     ⛔ Vakten måste vara BREDARE än extraktionen: "Graderad 7" utan bolagsnamn
 *     är fortfarande ett graderat kort och hör inte hemma i den råa kurvan.
 *
 *  2. `detectGrading()` — EXTRAKTIONEN. Vilket bolag och vilket betyg? Används av
 *     den graderade serien, som är nyckelad på (produkt, bolag, betyg).
 *
 * ⛔ TRADERAS STRUKTURERADE ATTRIBUT VINNER ÖVER TITELN. Annonser i Pokémon-
 * kategorierna bär `pokemon_grading_issuer` och `pokemon_grade` som TermAttributeValue
 * (mätt 2026-09-04: bolag 83 %, betyg 77 %, båda 76 % i kategori 1001338). Titeln är
 * bara fallback — och den enda vägen till bolagsnamnet när attributet säger "Övriga",
 * som är Traderas samlingsvärde för allt utom PSA/CGC/Raukcard/ACE/Beckett.
 *
 * ⛔ ASPIRATIONSSPRÅK ÄR INTE EN GRADERING. Riktiga titlar ur produktionsdata:
 * "PSA10 Kandidat - Cubone 60/112", "Clefairy 094/088 möjligen psa 10",
 * "...WOTC perfekt för gradering". Det är OGRADERADE kort som säljaren tror skulle
 * få ett visst betyg. Utan vetot hade vakten kastat bort riktiga råa prispunkter.
 */

/** Normaliserat bolag. `OTHER` = graderat, men bolaget går inte att fastställa. */
export type GradingIssuer =
  | "PSA"
  | "BGS"
  | "CGC"
  | "SGC"
  | "ACE"
  | "RAUKCARD"
  | "TAG"
  | "HGA"
  | "GMA"
  | "ISA"
  | "AGS"
  | "GG"
  | "OTHER";

export interface GradingInfo {
  issuer: GradingIssuer;
  /** Betyg × 10 (100 = 10,0 · 95 = 9,5). ⛔ Heltal, aldrig float — och aldrig en
   *  sträng: "10" sorterar före "9" och skulle vända hela skalan. */
  gradeTenths: number | null;
  /** Var domen kom ifrån. `attribute` är Traderas eget fält, `title` är gissat. */
  from: "attribute" | "title";
}

export interface GradedListingInput {
  title: string;
  /** `pokemon_grading_issuer` ur Traderas TermAttributeValues, om satt. */
  attrIssuer?: string | null;
  /** `pokemon_grade` ur Traderas TermAttributeValues, om satt. */
  attrGrade?: string | null;
}

/**
 * ⛔ VETO. Fraser som betyder "kortet är INTE graderat" — antingen för att
 * säljaren spekulerar om ett framtida betyg, eller för att hen uttryckligen
 * säger att kortet är rått. Slår före allt annat i titel-vägen.
 *
 * `ograderad` fångas inte av `\bgraderad\b` (o:et är ett ordtecken, så
 * ordgränsen saknas) — den behöver därför ingen egen undantagsregel i vakten,
 * men står här ändå eftersom "Ograderad, PSA 10-kandidat" bär BÅDA signalerna.
 */
const ASPIRATION_VETO =
  /\b(?:kandidat(?:er)?|m[öo]jligen|troligen|kanske|potentiell(?:t|a)?|nära|n[äa]stan|borde\s+f[åa]|skulle\s+f[åa]|v[äa]rd(?:ig|t)?\s+(?:att\s+)?grader|f[öo]r\s+grader(?:ing|as)|att\s+graderas?|pre-?grad\w*|ograderad\w*|ograderat|ungraded|to\s+grade|gradeable|grade\s+worthy|psa[-\s]?v[äa]rd\w*)\b/i;

/**
 * ⛔ "PERFEKT FÖR PSA 10" ÄR ETT OGRADERAT KORT. Samma aspiration som ovan, men
 * med BOLAGET i stället för ordet "gradering" efter "för" — och då biter inte
 * `för grader\w*`. Fångad på en riktig offer i produktionen 2026-09-04:
 * "…Dark Blastoise 20 Team Rocket WOTC perfekt for psa 1", där Tradera dessutom
 * KAPAT slugen mitt i "psa-10". Utan den här raden hade städningen raderat ett
 * korrekt rått pris.
 */
const ASPIRATION_BEFORE_ISSUER =
  /\b(?:perfekt|bra|redo|l[äa]mplig|passar|redo)\s+f[öo]r\s+(?:en\s+)?(?:psa|bgs|beckett|cgc|sgc|ace|rauk\s?card|rauk|tag|hga|gma|isa|ags)\b/i;

/**
 * Bolagsmönster i titeln. Ordningen spelar roll — mer specifika namn först.
 *
 * ⛔ `TAG` kräver negativ lookahead på "team": "Tag Team" är en KORTMEKANIK
 *    ("Reshiram & Charizard GX Tag Team"), inte graderingsbolaget TAG.
 * ⛔ `ACE` kräver negativ lookahead på "spec": "ACE SPEC" är en korttyp i S&V.
 */
const ISSUER_PATTERNS: { issuer: GradingIssuer; re: RegExp }[] = [
  { issuer: "PSA", re: /\bpsa\b/i },
  { issuer: "BGS", re: /\b(?:bgs|beckett|bvg)\b/i },
  { issuer: "CGC", re: /\bcgc\b/i },
  { issuer: "SGC", re: /\bsgc\b/i },
  { issuer: "RAUKCARD", re: /\brauk\s?card\b|\brauk\b/i },
  { issuer: "GG", re: /\bglobal\s?grading\b|\bgg\s*grad\w*/i },
  { issuer: "TAG", re: /\btag\b(?!\s*team)/i },
  { issuer: "ACE", re: /\bace\b(?!\s*spec)/i },
  { issuer: "HGA", re: /\bhga\b/i },
  { issuer: "GMA", re: /\bgma\b/i },
  { issuer: "ISA", re: /\bisa\b/i },
  { issuer: "AGS", re: /\bags\b/i },
];

/** Traderas egen vokabulär (`pokemon_grading_issuer`) → vårt normaliserade namn. */
const ATTR_ISSUER_MAP: Record<string, GradingIssuer> = {
  psa: "PSA",
  cgc: "CGC",
  beckett: "BGS",
  bgs: "BGS",
  sgc: "SGC",
  ace: "ACE",
  raukcard: "RAUKCARD",
  rauk: "RAUKCARD",
  tag: "TAG",
  hga: "HGA",
  gma: "GMA",
  isa: "ISA",
  ags: "AGS",
  globalgrading: "GG",
  gg: "GG",
};

/**
 * Generella "det här är ett graderat kort"-ord, utan bolagsnamn.
 * ⛔ `graderad`/`graderat` matchar INTE "ograderad" (ordgränsen saknas där).
 * ⛔ `slab` bara som eget ord — "slabbed"/"slabb" är för lösa för en vakt.
 * ⛔ `Gem Mint`/`Pristine`/`Black Label` KRÄVER ett betyg efter sig: orden
 *    används också som lös skickbeskrivning på råa kort ("gem mint condition").
 *    Med siffran är de entydigt CGC:s och Becketts betygsnamn.
 */
const GRADED_WORD =
  /\b(?:graderad|graderat|graderade|graded)\b|\bslab\b|\b(?:gem\s*mint|pristine|black\s*label)\s*(?:10|[1-9](?:[.,]5)?)\b/i;

/** Betyg 1–10 med halvsteg → tiondelar. Returnerar null utanför skalan. */
function toTenths(raw: string): number | null {
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const tenths = Math.round(n * 10);
  if (tenths < 10 || tenths > 100) return null;
  // Bara hela och halva steg finns på någon av skalorna.
  if (tenths % 5 !== 0) return null;
  return tenths;
}

/** "9.5" ur tiondelar, för visning. */
export function formatGrade(gradeTenths: number): string {
  return (gradeTenths / 10).toString();
}

/**
 * Betyg ur titeln. Tar BÅDA ordningsföljderna — säljarna skriver både
 * "RaukCard 9" och "Graded Card 9 RaukCard" — och orden före siffran
 * ("Gem Mint", "Pristine", "MT") är valfria.
 */
function gradeFromTitle(title: string): number | null {
  const t = title.replace(/,(\d)/g, ".$1");
  const issuerWords =
    "psa|bgs|beckett|bvg|cgc|sgc|rauk\\s?card|rauk|global\\s?grading|tag|ace|hga|gma|isa|ags";
  const qualifier = "(?:gem\\s*)?(?:mt|mint|pristine|perfect|black\\s*label)?\\s*";

  // "PSA 10", "BGS 9.5", "RaukCard Gem Mint 10", "CGC 9,5"
  const after = t.match(new RegExp(`\\b(?:${issuerWords})\\s*(?:card)?\\s*${qualifier}(10|[1-9](?:\\.5)?)\\b`, "i"));
  if (after) return toTenths(after[1]);

  // "Graded Card 9 RaukCard", "Graderad 7"
  const word = t.match(/\b(?:graderad|graderat|graderade|graded)\s*(?:card|kort)?\s*(10|[1-9](?:\.5)?)\b/i);
  if (word) return toTenths(word[1]);

  // "Pristine 10", "Gem Mint 10" — betyget utan bolag.
  const qual = t.match(/\b(?:gem\s*mint|pristine|black\s*label|mint)\s*(10|[1-9](?:\.5)?)\b/i);
  if (qual) return toTenths(qual[1]);

  return null;
}

/**
 * Bolaget, när det går att peka ut ETT. Flera bolagsnamn i samma titel = en lott
 * ("Charizard PSA 10 och Blastoise CGC 9") — då vet vi inte vilket, och domen blir
 * `OTHER`.
 *
 * ⛔ ANVÄNDS BARA AV EXTRAKTIONEN. Vakten måste svara "graderad" på just den
 * lotten också — annars hade en hög slabbar blivit en rå prispunkt, vilket är
 * precis det dyraste felet (lotpriser är summor, inte kortpriser).
 */
function issuerFromTitle(title: string): GradingIssuer | null {
  const hits = ISSUER_PATTERNS.filter((p) => p.re.test(title));
  if (hits.length !== 1) return null;
  return hits[0].issuer;
}

/** Nämner titeln NÅGOT graderingsbolag? (Vakten — antalet spelar ingen roll.) */
function mentionsAnyIssuer(title: string): boolean {
  return ISSUER_PATTERNS.some((p) => p.re.test(title));
}

/**
 * ÄR annonsen ett graderat kort? Vakten som håller slabbar ur den råa kurvan.
 *
 * Sann när Tradera säger det (attribut satt) ELLER när titeln säger det
 * (bolagsnamn + betyg, eller bara ordet "graderad"/"slab"). Aspirationsvetot
 * slår ut titel-vägen — men ALDRIG attribut-vägen: har säljaren fyllt Traderas
 * eget graderingsfält är det hens egen deklaration, inte vår tolkning.
 */
export function isGradedListing(input: GradedListingInput): boolean {
  if (input.attrIssuer?.trim() || input.attrGrade?.trim()) return true;
  const title = input.title ?? "";
  if (ASPIRATION_VETO.test(title) || ASPIRATION_BEFORE_ISSUER.test(title)) return false;
  if (GRADED_WORD.test(title)) return true;
  // Bolagsnamn ENSAMT räcker inte ("Ace Spec", "Tag Team", "isa" i ett namn) —
  // det krävs ett betyg intill för att det ska vara en slab.
  return mentionsAnyIssuer(title) && gradeFromTitle(title) != null;
}

/**
 * Bolag + betyg. `null` när annonsen inte är graderad alls.
 *
 * Attributet vinner, titeln fyller i. Ett känt betyg utan känt bolag ger
 * `OTHER` — det är fortfarande en användbar rad i den graderade serien, för
 * betyget är det som styr priset mest. Ett bolag utan betyg ger `gradeTenths:
 * null` och redovisas som "betyg okänt", aldrig som betyg 0.
 */
export function detectGrading(input: GradedListingInput): GradingInfo | null {
  if (!isGradedListing(input)) return null;

  const title = input.title ?? "";
  const attrIssuerRaw = input.attrIssuer?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
  const attrIssuer = ATTR_ISSUER_MAP[attrIssuerRaw];
  // Traderas "Övriga" är ett samlingsvärde — SGC, TAG, HGA och GMA hamnar alla
  // där. Bolaget finns då bara i titeln, så attributet får inte låsa domen.
  const titleIssuer = issuerFromTitle(title);
  const issuer: GradingIssuer = attrIssuer ?? titleIssuer ?? "OTHER";

  const attrGradeTenths = input.attrGrade ? toTenths(input.attrGrade.trim()) : null;
  const gradeTenths = attrGradeTenths ?? gradeFromTitle(title);

  return {
    issuer,
    gradeTenths,
    from: attrIssuer || attrGradeTenths != null ? "attribute" : "title",
  };
}

/**
 * ⛔ DEN RÅA PRISVAKTEN FÅR INTE RÖRA GRADERADE AFFÄRER.
 * `isPlausiblePriceFor` fäller en singel som kostar > 4× referensen OCH > 400 kr
 * över den. En PSA 10 för 8 000 kr mot ett CM-golv på 500 kr fälls alltså — och
 * det är exakt den affär serien finns för att visa. Att gradera ett kort ÄR att
 * mångdubbla priset; en övre gräns mot det ograderade priset är en motsägelse.
 *
 * Kvar blir en UNDRE gräns, som fångar det den ska: felmatchning. Ett graderat
 * kort säljs praktiskt taget aldrig för en bråkdel av det ograderades pris — går
 * det under 15 % av referensen är det en annan vara, inte ett fynd.
 * (Samma extrema tröskel som `MARKETPLACE_MIN_PRICE_RATIO`, av samma skäl:
 * referensen är själv ibland felmappad, så bara grova fel får fällas.)
 */
export const GRADED_MIN_PRICE_RATIO = 0.15;
export function isPlausibleGradedPriceOre(
  refOre: number | null | undefined,
  priceOre: number
): boolean {
  if (priceOre <= 0) return false;
  if (refOre == null || refOre <= 0) return true;
  return priceOre >= refOre * GRADED_MIN_PRICE_RATIO;
}

/** Visningsnamn för ett bolag. */
export const ISSUER_LABELS: Record<GradingIssuer, string> = {
  PSA: "PSA",
  BGS: "BGS",
  CGC: "CGC",
  SGC: "SGC",
  ACE: "ACE",
  RAUKCARD: "RaukCard",
  TAG: "TAG",
  HGA: "HGA",
  GMA: "GMA",
  ISA: "ISA",
  AGS: "AGS",
  GG: "GlobalGrading",
  OTHER: "Annat bolag",
};
