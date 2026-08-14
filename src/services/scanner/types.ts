/**
 * Typer för kortskannern. Skannern är adapterbaserad: vilken OCR-/vision-
 * leverantör som helst kan kopplas in genom att implementera `OcrAdapter`
 * och registreras i `getOcrAdapter()` (se src/services/scanner/index.ts
 * samt docs/SCANNER.md).
 */

/** Resultat från en OCR-/vision-analys av en kortbild. */
export interface OcrResult {
  /** Rå text som extraherats ur bilden. */
  rawText: string;
  /** Bästa gissning på kortets namn, om någon. */
  guessedName?: string;
  /** Bästa gissning på setnummer (t.ex. "25/102"), om något. */
  guessedNumber?: string;
  /**
   * Kortramens GENERATION ("wotc", "ex", "dp", "bwxy", "sm", "swsh", "sv").
   *
   * Finns för att ramdesignen är läsbar när samlarnumret inte är det (numret är
   * ~3 px på ett skärmfoto; ramen är hela kortet). Ett namn-oavgjort läge —
   * 28 kort heter exakt "Gyarados" — avgjordes förut av "nyast set först", så
   * ett 2005-kort kunde aldrig vinna och fick inte ens plats i kandidatlistan.
   * Eran är en GROV signal för ett GROVT beslut: vilken tidsepok, aldrig vilket
   * exakt kort. Se ERA_YEARS i src/services/scanner/index.ts.
   */
  guessedEra?: string;
  /**
   * Kortets HP — det STÖRSTA tryckta talet på kortet, läsbart även när
   * samlarnumret (~3 px på skärmfoto) inte är det. Mätt särskiljare: 28 kort
   * heter exakt "Gyarados", bara 3 har HP 90. Bevisat att modellen läser det:
   * den svarade med HP:t när vi bad om samlarnumret (fix 14f4a52).
   */
  guessedHp?: number;
  /** Leverantörens konfidens 0..1. */
  confidence: number;
  /**
   * API:ts EGNA tokental för anropet (response.usage). Sparas i admin-
   * diagnostiken så per-scan-kostnaden är en MÄTNING, inte en uppskattning —
   * konsolens dagssumma blandar skannern med batch-jobbens Haiku-anrop
   * (Tradera-matchningen m.fl.) och kan inte särskilja dem.
   */
  usage?: { inputTokens: number; outputTokens: number };
}

/** Adapter mot en OCR-/vision-leverantör. */
export interface OcrAdapter {
  /** Leverantörens namn, t.ex. "mock", "google-vision". */
  name: string;
  /**
   * Modell-id:t adaptern faktiskt anropar ("claude-haiku-4-5",
   * "gemini-3.1-flash-lite"). `null` för mocken, som inte kostar något.
   *
   * ⛔ Leverantörsnamnet duger INTE för kostnadsberäkning: "claude" kan vara
   * Haiku (1/5 $ per MTok) eller Sonnet (3/15 $) beroende på `precise`, dvs en
   * faktor tre. Kostnaden räknas i efterhand ur sparade rader, så modellnamnet
   * måste följa med in i databasen — se recordScanUsage.
   */
  model: string | null;
  /**
   * Extraherar kortinformation ur en bild (data-URL, base64).
   *
   * `detailDataUrl` är en valfri NÄRBILD på kortets nederkant, där samlarnumret
   * trycks. Den finns för att felet inte var läsbarhet utan LOKALISERING: med
   * gott om upplösning svarade modellen ändå med kortets HP (stort, uppe till
   * höger) i stället för samlarnumret (litet, nere till vänster). En bild som
   * bara innehåller nederkanten tar bort förväxlingen.
   */
  extractCardInfo(imageDataUrl: string, detailDataUrl?: string): Promise<OcrResult>;
}

/**
 * En VARIANT av samma kort — ordinarie, reverse holo, Master/Poké Ball, eller en
 * av Base-tryckningarna. Samma Card, olika Product.
 *
 * ⛔ VARIANTEN ÄR ETT VAL, INTE EN GISSNING. Skannern identifierar ett KORT: konst
 * och samlarnummer är identiska mellan en reverse holo och det ordinarie kortet,
 * och foliemönstret finns varken i konstavtrycket eller i modellens svar. Att låta
 * matchningen "välja" variant vore alltså att hitta på ett svar. Den ordinarie
 * varianten är förvalet och användaren byter själv — precis som med skicket.
 */
export interface ScanVariant {
  productId: string;
  /** "Reverse Holo", "1st Edition", … — `null` = den ordinarie varianten. */
  label: string | null;
  slug: string;
  /** Variantens EGET marknadsvärde i öre — en reverse holo är ofta dyrare. */
  estimatedValue: number | null;
}

/** En matchningskandidat som returneras till klienten. */
export interface ScanCandidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  /** Produktens slug för djuplänk till produktsidan, om kortet har en produkt. */
  slug: string | null;
  /**
   * Produkten kandidaten gäller, när den pekar på en SPECIFIK TRYCKNING.
   *
   * Base-korten har ETT Card men TRE produkter (Unlimited / Shadowless /
   * 1st Edition, 157 kort i katalogen) — och de kan inte skiljas på utseende,
   * bara på tryckningsetiketten. Utan produkt-id kunde skannern inte ens
   * ERBJUDA valet: den matchade på Card och tog den billigaste produkten, så en
   * 1st Edition landade tyst i samlingen som Unlimited.
   */
  productId: string | null;
  /** Den VALDA variantens namn ("Reverse Holo", "1st Edition"), `null` = ordinarie. */
  variantLabel: string | null;
  /**
   * Alla varianter kortet finns i, ordinarie först (`variantDisplayRank`).
   * Utelämnad när kortet bara finns i en — då finns inget att välja mellan.
   */
  variants?: ScanVariant[];
  /** Matchningspoäng 0..1. */
  score: number;
  /**
   * Har kandidaten SAMMA KONST som träffen? (Referensavtrycken är nästan
   * identiska — se SAME_ART_MIN.)
   *
   * Omtryck med identisk konst är exakt de kort bildmatchningen inte KAN skilja
   * åt: bara samlarnumret skiljer dem, och det är det svåraste att läsa. Därför
   * visar detaljvyn dem ALLTID, oavsett poängfönster — annars går en felmatchning
   * inte att rätta. `false` när bildmatchningen inte kördes eller kortet saknar
   * avtryck; då gäller poängfönstret som vanligt.
   */
  sameArt?: boolean;
  /**
   * Kandidatens plats i BILDENS egen topplista (1 = bildens bästa gissning).
   * Odefinierad när kortet inte låg i bildens topp alls.
   *
   * ⛔ Detaljvyn visar ALLTID bildens tre bästa, oavsett slutpoäng. MÄTT
   * 2026-08-02: när modellen läser ett TRUNKERAT namn ("Komala" på ett kort som
   * heter "Larry's Komala") matchar texten ett HELT ANNAT kort exakt och slår
   * bilden — och eftersom vinnaren då varken delar namn eller konst med rätt
   * kort föll rätt kort ur alternativlistan. Bilden hade rätt i alla tre
   * observerade fallen; den måste alltid gå att välja.
   */
  artRank?: number;
  /** Aktuellt marknadsvärde i öre (Cardmarket-trend via kortets produkt), om känt. */
  estimatedValue: number | null;
}
