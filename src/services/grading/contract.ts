/**
 * GRADERINGSKONTRAKTET — delat mellan alla vision-leverantörer.
 *
 * ⛔ EN källa för systemprompten, fältspecen, bildetiketterna OCH tolkningen av
 * svaret. Exakt samma skäl som `src/services/scanner/vision-contract.ts` och
 * `src/services/deal-verify/contract.ts`: byter man leverantör vill man veta om
 * MODELLEN blev bättre eller sämre, och två egna prompter/parsers gör
 * jämförelsen värdelös — då jämför man prompter. Får Gemini en egen kopia av den
 * här prompten är varje kvalitetsskillnad OTILLSKRIVBAR.
 *
 * Leverantörsadaptern gör BARA tre saker: översätter fältspecen till sitt eget
 * schemaformat, skickar bilderna, och lämnar tillbaka de råa fälten hit.
 *
 * VIKTIGT: utfallet är en AI-UPPSKATTNING av kortets skick, aldrig en officiell
 * PSA-/BGS-gradering — vilket systemprompten är uttrycklig med.
 */
import { ServiceError } from "@/lib/errors";
import { parseDataUrl } from "@/services/scanner/vision-contract";
import type { GradeResult } from "@/services/grading/types";

export const SYSTEM = [
  "Du är en expert på att bedöma skicket (condition) på Pokémon-samlarkort.",
  "Du får en framsidesbild och en baksidesbild av samma kort.",
  "Bedöm fyra kriterier på en skala 1–10 (10 = perfekt):",
  "- centering: hur centrerat trycket/ramen är (fram + bak).",
  "- corners: hörnens skick (vassa vs trubbiga/vita).",
  "- edges: kanternas skick (whitening, nötning, flisor).",
  "- surface: ytans skick (repor, fingeravtryck, print lines, scratches, dents).",
  "Sätt sedan en sammanvägd PSA-LIKNANDE helhetsgrad 1–10 (en decimal tillåten),",
  "samt en konfidens 0–1 utifrån bildkvaliteten, och en kort motivering på svenska.",
  "Var sträng och realistisk — de flesta kort hamnar mellan 6 och 9.",
  "Om bilderna är suddiga eller delvis skymda: sänk konfidensen.",
  "Ange också vilket kort du ser i fältet cardName, kort och utan meningsbyggnad:",
  "namn, kortnummer och set, t.ex. \"Torchic 65/100 · EX Crystal Guardians\".",
  "Är du osäker på kortet — utelämna cardName helt hellre än att gissa.",
  "Detta är en UPPSKATTNING, inte en officiell PSA-/BGS-gradering.",
].join(" ");

export const GRADE_TOOL_NAME = "report_grade";
export const GRADE_TOOL_DESCRIPTION =
  "Rapportera den bedömda graderingen av kortet.";

/** Etiketterna framför respektive bild. Två omärkta bilder gör det oklart vilken
 *  sida som är vilken, och centrering bedöms på BÅDA medan baksidan är det enda
 *  som avslöjar t.ex. whitening längs baksidans kanter. */
export const IMAGE_LABEL_FRONT = "Framsida:";
export const IMAGE_LABEL_BACK = "Baksida:";

/**
 * Slutinstruktionen — ORDAGRANT densamma för alla leverantörer, inklusive den
 * valfria kortnamnshinten. Ligger här och inte i adaptrarna av precis samma skäl
 * som systemprompten: ett extra mellanslag i den ena adaptern räcker för att en
 * A/B-körning ska mäta formatering i stället för modell.
 */
export function buildClosingInstruction(cardNameHint?: string): string {
  const hint = cardNameHint ? ` Kortet är troligen: ${cardNameHint}.` : "";
  return `Bedöm kortets skick och anropa ${GRADE_TOOL_NAME} med dina poäng.${hint}`;
}

/** Fältspec i leverantörsneutral form. Varje adapter mappar `type` till sitt
 *  eget schemaspråk (Anthropic: gemener; Gemini/OpenAPI: VERSALER). */
export interface GradeField {
  name: string;
  type: "boolean" | "string" | "integer" | "number";
  description: string;
  enum?: string[];
  /** Fältet hamnar INTE i required-listan. Se cardName nedan. */
  optional?: true;
}

export const GRADE_FIELDS: GradeField[] = [
  { name: "centering", type: "number", description: "1–10" },
  { name: "corners", type: "number", description: "1–10" },
  { name: "edges", type: "number", description: "1–10" },
  { name: "surface", type: "number", description: "1–10" },
  {
    name: "overall",
    type: "number",
    description: "Sammanvägd helhetsgrad 1–10",
  },
  { name: "confidence", type: "number", description: "0–1" },
  {
    name: "rationale",
    type: "string",
    description: "Kort motivering på svenska.",
  },
  {
    // MEDVETET optional: hellre inget kortnamn än ett gissat. Ett fel namn på en
    // gradering användaren sparar i samlingen är värre än inget namn.
    name: "cardName",
    type: "string",
    optional: true,
    description:
      'Kortet på bilden: namn, nummer och set, t.ex. "Torchic 65/100 · EX Crystal Guardians". Utelämna om du är osäker.',
  },
];

/** ⛔ HÄRLEDD, aldrig handskriven. En andra lista hade kunnat glida isär från
 *  fältspecen, och då blir cardName obligatoriskt igen — dvs modellen tvingas
 *  gissa ett kortnamn. Testet `grading-contract.test.ts` vaktar synken. */
export const GRADE_REQUIRED = GRADE_FIELDS.filter((f) => !f.optional).map(
  (f) => f.name
);

/**
 * Data-URL → (mediatyp, base64). ⛔ Ingen egen regex här: parsningen delas med
 * skannerns kontrakt så att de två inte kan börja acceptera olika bildformat.
 * Bara FELTEXTEN är graderingens egen — användaren står på /gradera och ska få
 * veta att det var graderingsbilden som inte gick att läsa.
 */
export function parseGradingImage(dataUrl: string): {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
} {
  try {
    return parseDataUrl(dataUrl);
  } catch {
    throw new ServiceError(
      400,
      "Bildformatet stöds inte för gradering. Använd JPG, PNG, WEBP eller GIF."
    );
  }
}

/** Kläm ett tal till [lo, hi]; icke-tal och NaN blir `fallback`. */
export const clamp = (
  n: unknown,
  lo: number,
  hi: number,
  fallback: number
): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
};

/** Kortnamnet är fritext från en modell och hamnar i GradingJob.result. */
const CARD_NAME_MAX = 120;

/**
 * De råa verktygsfälten → GradeResult. ⛔ ALL tolkning bor här, inte i
 * adaptrarna: klämningen till 1–10, avrundningen av helhetsgraden till en
 * decimal och regeln att ett tomt cardName blir `undefined` (aldrig en tom
 * sträng som UI:t sedan visar som ett kort utan namn). Skiljer sig det här
 * mellan leverantörer mäter en A/B-jämförelse parsern, inte modellen.
 */
export function buildGradeResult(
  input: Record<string, unknown>,
  modelUsed: string
): GradeResult {
  const subScores = {
    centering: clamp(input.centering, 1, 10, 5),
    corners: clamp(input.corners, 1, 10, 5),
    edges: clamp(input.edges, 1, 10, 5),
    surface: clamp(input.surface, 1, 10, 5),
  };
  const overall = Math.round(clamp(input.overall, 1, 10, 5) * 10) / 10;

  return {
    overall,
    subScores,
    confidence: clamp(input.confidence, 0, 1, 0.5),
    rationale:
      typeof input.rationale === "string" && input.rationale.trim()
        ? input.rationale.trim()
        : "Ingen motivering tillgänglig.",
    modelUsed,
    cardName:
      typeof input.cardName === "string" && input.cardName.trim()
        ? input.cardName.trim().slice(0, CARD_NAME_MAX)
        : undefined,
  };
}
