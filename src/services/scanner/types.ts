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
  /** Tryckningens namn ("Unlimited", "Shadowless", "1st Edition"), om någon. */
  variantLabel: string | null;
  /** Matchningspoäng 0..1. */
  score: number;
  /** Aktuellt marknadsvärde i öre (Cardmarket-trend via kortets produkt), om känt. */
  estimatedValue: number | null;
}
