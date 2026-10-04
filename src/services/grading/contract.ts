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
import type { GradeDefect, GradeResult, TokenUsage } from "@/services/grading/types";

/** Språken appen kan visa. `rationale` är MODELLGENERERAD prosa, så den kan
 *  aldrig översättas via messages/*.json — språket måste följa med förfrågan. */
export type GradingLocale = "sv" | "en";

/** ⛔ Sista utvägen, inte den normala vägen: `/api/grading/grade` SKICKAR alltid
 *  användarens locale. Fanns den här reserven inte skulle ett direktanrop av en
 *  adapter krascha; är den för generös blir språkbuggen tyst igen. */
export const DEFAULT_GRADING_LOCALE: GradingLocale = "sv";

export function resolveGradingLocale(locale?: string | null): GradingLocale {
  return locale === "en" ? "en" : DEFAULT_GRADING_LOCALE;
}

/** Instruktionen står kvar på svenska för ALLA språk — det är modell-riktad text,
 *  och att byta hela promptspråket hade ändrat mer än utdataspråket (dvs gjort en
 *  leverantörsjämförelse otillförlitlig). Bara motiveringens språk varierar. */
const RATIONALE_LANGUAGE: Record<GradingLocale, string> = {
  sv: "på svenska",
  en: "på engelska",
};

export function buildSystem(locale: GradingLocale): string {
  return [
    "Du är en expert på att bedöma skicket (condition) på Pokémon-samlarkort.",
    "Du får en framsidesbild och en baksidesbild av samma kort.",
    "Bedöm fyra kriterier på en skala 1–10 (10 = perfekt):",
    "- centering: hur centrerat trycket/ramen är (fram + bak).",
    "- corners: hörnens skick (vassa vs trubbiga/vita).",
    "- edges: kanternas skick (whitening, nötning, flisor).",
    "- surface: ytans skick (repor, fingeravtryck, print lines, scratches, dents).",
    "Sätt sedan en sammanvägd PSA-LIKNANDE helhetsgrad 1–10 (en decimal tillåten),",
    `samt en konfidens 0–1 utifrån bildkvaliteten, och en kort motivering ${RATIONALE_LANGUAGE[locale]}.`,
    "Var sträng och realistisk — de flesta kort hamnar mellan 6 och 9.",
    "Om bilderna är suddiga eller delvis skymda: sänk konfidensen.",
    "Ange också vilket kort du ser i fältet cardName, kort och utan meningsbyggnad:",
    "namn, kortnummer och set, t.ex. \"Torchic 65/100 · EX Crystal Guardians\".",
    "Är du osäker på kortet — utelämna cardName helt hellre än att gissa.",
    "Lista sedan varje SYNLIG skada i fältet defects (högst " + MAX_DEFECTS + "): vilken bild (front/back),",
    "kategori (corners/edges/surface), allvar (minor/moderate/major), en kort beskrivning",
    `${RATIONALE_LANGUAGE[locale]} (t.ex. "Vitt slitage i övre vänstra hörnet") och en tät ruta runt skadan`,
    "som ymin, xmin, ymax, xmax i heltal 0–1000 relativt just den bilden (0,0 = övre vänstra hörnet).",
    "Ta BARA med skador du faktiskt ser på bilderna — en tom lista är bättre än en påhittad skada,",
    "och reflexer, damm på kameran eller bordet runt kortet är inga skador.",
    "Detta är en UPPSKATTNING, inte en officiell PSA-/BGS-gradering.",
  ].join(" ");
}

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
export function buildClosingInstruction(cardNameHint?: string, centeringNote?: string): string {
  const hint = cardNameHint ? ` Kortet är troligen: ${cardNameHint}.` : "";
  // UPPMÄTT CENTRERING (2026-10-01): användaren har lagt stödlinjer på sina foton
  // (lib/centering.ts). Ett MÄTT tal slår modellens ögonmått på just det kriteriet;
  // PSA:s gränser står med så att talet översätts lika varje gång.
  const centering = centeringNote
    ? ` Användaren har mätt centreringen med stödlinjer på fotona: ${centeringNote}.` +
      " Utgå från mätningen när du sätter centering (PSA: framsida 55/45 för 10, 60/40 för 9," +
      " 65/35 för 8, 70/30 för 7; baksida 75/25 för 10, 90/10 därunder)."
    : "";
  return `Bedöm kortets skick och anropa ${GRADE_TOOL_NAME} med dina poäng.${hint}${centering}`;
}

/** Fältspec i leverantörsneutral form. Varje adapter mappar `type` till sitt
 *  eget schemaspråk (Anthropic: gemener; Gemini/OpenAPI: VERSALER). */
export interface GradeField {
  name: string;
  type: "boolean" | "string" | "integer" | "number" | "array";
  description: string;
  enum?: string[];
  /** Fältet hamnar INTE i required-listan. Se cardName nedan. */
  optional?: true;
  /** `type: "array"`: varje element är ett objekt med de här fälten (alla obligatoriska). */
  items?: GradeField[];
}

/** Högst så många skademarkeringar sparas — fler blir brus på ett litet foto. */
export const MAX_DEFECTS = 8;
export const DEFECT_SIDES = ["front", "back"] as const;
export const DEFECT_CATEGORIES = ["corners", "edges", "surface"] as const;
export const DEFECT_SEVERITIES = ["minor", "moderate", "major"] as const;

/** En skadas fält. Rutan är Geminis egen konvention (0–1000, y före x) — den
 *  konvention modellen är tränad på att peka med; Claude följer den lika gärna. */
const DEFECT_FIELDS: GradeField[] = [
  { name: "side", type: "string", enum: [...DEFECT_SIDES], description: "Bilden skadan syns på." },
  { name: "category", type: "string", enum: [...DEFECT_CATEGORIES], description: "Kriteriet skadan drar ned." },
  { name: "severity", type: "string", enum: [...DEFECT_SEVERITIES], description: "Hur allvarlig skadan är." },
  { name: "note", type: "string", description: "Kort beskrivning av skadan." },
  { name: "ymin", type: "integer", description: "0–1000" },
  { name: "xmin", type: "integer", description: "0–1000" },
  { name: "ymax", type: "integer", description: "0–1000" },
  { name: "xmax", type: "integer", description: "0–1000" },
];

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
    // ⛔ NÄMN INTE SPRÅKET HÄR. Fältbeskrivningen går med i verktygsschemat och
    // läses av modellen samtidigt som systemprompten. Stod det "på svenska" här
    // motsade det `buildSystem("en")` och modellen fick två motstridiga order —
    // vilket är precis varför språkfixen 2026-08-05 nästan blev verkningslös.
    // SYSTEMPROMPTEN äger språket, ensam.
    name: "rationale",
    type: "string",
    description: "Kort motivering.",
  },
  {
    // OBLIGATORISK men får vara TOM: modellen ska alltid ta ställning till
    // skadorna, och "inga synliga" är ett giltigt svar (2026-10-04).
    name: "defects",
    type: "array",
    description: "Synliga skador med en ruta runt varje. Tom lista om inga syns.",
    items: DEFECT_FIELDS,
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

const DEFECT_NOTE_MAX = 140;
/** Minsta rutans sida (andel av bilden) — en punkt går inte att se på en telefon. */
const DEFECT_MIN_SIZE = 0.03;

const inSet = <T extends string>(set: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (set as readonly string[]).includes(v);

/**
 * Modellens skadelista → validerade markeringar med rutan som ANDELAR (0–1) av
 * bilden. Allt som inte går att tolka kastas tyst — en trasig post ska aldrig
 * fälla en gradering, och en gissad sida/kategori vore en påhittad skada.
 */
export function parseDefects(input: unknown): GradeDefect[] {
  if (!Array.isArray(input)) return [];
  const out: GradeDefect[] = [];
  for (const raw of input) {
    if (out.length >= MAX_DEFECTS) break;
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    if (!inSet(DEFECT_SIDES, d.side) || !inSet(DEFECT_CATEGORIES, d.category)) continue;
    const severity = inSet(DEFECT_SEVERITIES, d.severity) ? d.severity : "minor";
    const note = typeof d.note === "string" ? d.note.trim().slice(0, DEFECT_NOTE_MAX) : "";
    if (!note) continue;
    const coords = [d.ymin, d.xmin, d.ymax, d.xmax];
    if (!coords.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const [y0, x0, y1, x1] = (coords as number[]).map((n) => Math.min(1000, Math.max(0, n)) / 1000);
    let x = Math.min(x0, x1);
    let y = Math.min(y0, y1);
    let w = Math.abs(x1 - x0);
    let h = Math.abs(y1 - y0);
    // Hela bilden är ingen markering.
    if (w > 0.95 && h > 0.95) continue;
    if (w < DEFECT_MIN_SIZE) {
      x = Math.min(1 - DEFECT_MIN_SIZE, Math.max(0, x + w / 2 - DEFECT_MIN_SIZE / 2));
      w = DEFECT_MIN_SIZE;
    }
    if (h < DEFECT_MIN_SIZE) {
      y = Math.min(1 - DEFECT_MIN_SIZE, Math.max(0, y + h / 2 - DEFECT_MIN_SIZE / 2));
      h = DEFECT_MIN_SIZE;
    }
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    out.push({ side: d.side, category: d.category, severity, note, x: r3(x), y: r3(y), w: r3(w), h: r3(h) });
  }
  return out;
}

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
  modelUsed: string,
  /**
   * API:ts egna tokental för anropet. Sparas i GradingJob så adminpanelen kan
   * räkna VERKLIG kostnad per användare i stället för en schablon per gradering
   * (två foton à upp till 5 MB gör spridningen stor). Utelämnas den räknas
   * graderingen som OMÄTT, aldrig som gratis — se src/lib/ai-pricing.ts.
   */
  usage?: TokenUsage
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
    defects: parseDefects(input.defects),
    usage,
  };
}
