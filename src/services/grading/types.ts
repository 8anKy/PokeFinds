/**
 * Typer för AI-baserad kortgradering. Som skannern är graderingen
 * adapterbaserad: vilken vision-leverantör som helst kan kopplas in genom att
 * implementera `GradingAdapter` och registreras i `getGradingAdapter()`
 * (se src/services/grading/index.ts).
 *
 * VIKTIGT: detta är en AI-UPPSKATTNING av kortets skick, inte en officiell
 * PSA-/BGS-gradering.
 */

/** Delpoäng (1–10) för de fyra huvudkriterierna vid kortgradering. */
export interface GradeSubScores {
  /** Centrering av tryck/ram. */
  centering: number;
  /** Hörnens skick. */
  corners: number;
  /** Kanternas skick (whitening, nötning). */
  edges: number;
  /** Ytans skick (repor, fingeravtryck, print lines). */
  surface: number;
}

/**
 * API:ts EGNA tokental för anropet. Grunden för kostnad-per-användare i
 * adminpanelen — ett uppmätt tal, aldrig en schablon per gradering (bilderna
 * skalas inte ner, så in-tokens varierar kraftigt mellan två foton).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Resultat av en gradering. */
export interface GradeResult {
  /** Sammanvägd PSA-liknande gradering 1–10 (en decimal). */
  overall: number;
  subScores: GradeSubScores;
  /** Modellens konfidens 0..1. */
  confidence: number;
  /** Kort motivering på svenska. */
  rationale: string;
  /** Vilken modell/leverantör som användes (t.ex. "claude-haiku-4-5", "mock"). */
  modelUsed: string;
  /**
   * Kortet modellen anser sig se, t.ex. "Torchic 65/100 · EX Crystal Guardians".
   * Undefined när kortet inte gick att identifiera — visa aldrig en gissning som
   * fakta, och koppla ALDRIG ihop den här strängen med katalogen automatiskt
   * (det är en bildtolkning, inte en matchning).
   */
  cardName?: string;
  /**
   * Tokentalen anropet förbrukade. Undefined för mocken och för adaptrar som
   * inte rapporterar dem — då räknas graderingen som OMÄTT i kostnadsvyn,
   * aldrig som gratis.
   */
  usage?: TokenUsage;
}

/** Extra kontext som kan förbättra graderingen. */
export interface GradingContext {
  /** Kortnamn om känt (t.ex. från en tidigare skanning). */
  cardName?: string;
  /**
   * Användarens språk. `rationale` skrivs AV MODELLEN och kan därför inte
   * översättas via messages/*.json — språket måste följa med förfrågan.
   * Utelämnas det faller vi tillbaka på `DEFAULT_GRADING_LOCALE`.
   * OBS: en sparad gradering behåller det språk den skrevs på; historiken kan
   * alltså vara blandad om användaren byter språk. Det är en ögonblicksbild.
   */
  locale?: string;
}

/** Adapter mot en vision-leverantör som graderar fram- och baksidesbild. */
export interface GradingAdapter {
  /** Leverantörens namn, t.ex. "mock", "claude". */
  name: string;
  /**
   * Graderar ett kort utifrån fram- och baksidesbild (data-URL, base64).
   */
  grade(
    frontDataUrl: string,
    backDataUrl: string,
    context?: GradingContext
  ): Promise<GradeResult>;
}
