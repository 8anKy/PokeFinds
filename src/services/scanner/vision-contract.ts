/**
 * VISION-KONTRAKTET — delat mellan alla vision-leverantörer.
 *
 * ⛔ EN källa för systemprompten, fältbeskrivningarna OCH tolkningen av svaret.
 * Skälet är mätbarheten: byter man leverantör vill man veta om MODELLEN blev
 * bättre eller sämre, och två egna prompter/parsers gör jämförelsen värdelös
 * (då jämför man prompter). Samma läxa som `fingerprintFromRgb`, där klient och
 * harness delar aritmetik just för att mätningen ska gälla det som shippar.
 *
 * Leverantörsadaptern gör BARA tre saker: översätter fältspecen till sitt eget
 * schemaformat, skickar bilderna, och lämnar tillbaka de råa fälten hit.
 */
import { ServiceError } from "@/lib/errors";
import type { OcrResult } from "@/services/scanner/types";

export const SYSTEM = [
  "Du identifierar Pokémon-samlarkort från EN bild eller videoruta.",
  "Läs kortets namn (t.ex. 'Charizard ex').",
  "SAMLARNUMRET ÄR AVGÖRANDE: många kort delar namn (t.ex. flera 'Wailord'),",
  "och numret är det enda som skiljer dem åt. Det står i regel i ett NEDRE HÖRN,",
  "ofta litet, som 'nummer/total' (t.ex. '41/159', '199/091') eller med set-kod",
  "(t.ex. 'SVP 041').",
  "Får du TVÅ bilder är den andra en närbild på kortets NEDERKANT: läs numret",
  "DÄR, inte i helbilden. Namnet läser du ur helbilden.",
  "FLERA TAL KONKURRERAR PÅ ETT KORT — bara ETT av dem är samlarnumret:",
  "talet uppe till HÖGER intill 'HP' är kortets livpoäng (t.ex. 110) och är",
  "ALDRIG samlarnumret; skadetalen vid attackerna är det inte heller; och",
  "årtalet i copyrightraden ('2022') är det inte heller.",
  "Samlarnumret står längst ned, i regel till VÄNSTER (äldre kort: till höger),",
  "med den minsta texten på hela kortet.",
  "SKRIV AV NUMRET EXAKT SOM DET STÅR, tecken för tecken — gissa aldrig.",
  "BOKSTÄVER I NUMRET ÄR EN DEL AV NUMRET och får ALDRIG utelämnas:",
  "'TG10/TG30' skrivs 'TG10/TG30' (inte '10'), 'GG08' skrivs 'GG08',",
  "'SWSH034' skrivs 'SWSH034', 'SV075' skrivs 'SV075'.",
  "En efterföljande bokstav hör också till numret: '130a' är INTE '130'.",
  "Behåll inledande nollor och mellanslag som de står ('MEP 074').",
  "SÄTT numberLegible=false om du inte kunde läsa varje tecken tydligt — om du",
  "gissade, härledde numret ur kortets utseende, eller inte såg det. Ett påhittat",
  "nummer är VÄRRE än inget: det pekar ut ett annat riktigt kort. Att svara",
  "numberLegible=false är alltid ett godtagbart svar.",
  "ANGE OCKSÅ KORTRAMENS GENERATION (era): ramdesignen syns även när texten är",
  "oläslig, och den skiljer kort som delar namn. OBS: ramen är GUL på ALLA kort",
  "före 2023 — ramfärgen skiljer bara sv från resten. Skilj epokerna på LAYOUTEN:",
  "wotc (1999–2003, Base till Skyridge): evolutionsruta med miniatyrbild UPPE",
  "till vänster, OVANFÖR konsten. ex (2003–2007, Ruby & Sapphire till Power",
  "Keepers): STAGE-flik med miniatyrbild NERE till vänster som ÖVERLAPPAR",
  "konsten. dp (2007–2011, Diamond & Pearl/Platinum/HGSS). bwxy (2011–2016,",
  "Black & White/XY). sm (2017–2019, Sun & Moon). swsh (2020–2022, Sword &",
  "Shield). sv (2023–, Scarlet & Violet: SILVER/GRÅ ram). Osäker: okand.",
  "LÄS OCKSÅ KORTETS HP — det stora talet uppe till höger intill 'HP' (t.ex.",
  "90, 150). HP:t skiljer kort som delar namn. Sätt hp=0 om det inte går att",
  "läsa säkert — gissa aldrig.",
  "Returnera en konfidens 0–1 utifrån hur tydligt kortet syns och hur säker du är.",
  "Om inget tydligt Pokémon-kort syns: sätt cardVisible=false och låg konfidens.",
].join(" ");

export const CARD_TOOL_NAME = "report_card";
export const CARD_TOOL_DESCRIPTION = "Rapportera det identifierade kortet.";

/** Etiketterna framför respektive bild. Två omärkta bilder gör det oklart
 *  vilken som är vilken, och hela poängen är att numret läses ur den andra. */
export const IMAGE_LABEL_FULL = "Bild 1 — hela kortet (läs NAMNET här):";
export const IMAGE_LABEL_DETAIL =
  "Bild 2 — NÄRBILD på kortets nederkant (läs SAMLARNUMRET här):";
export const CLOSING_INSTRUCTION = `Identifiera kortet och anropa ${CARD_TOOL_NAME}.`;

/** Fältspec i leverantörsneutral form. Varje adapter mappar `type` till sitt
 *  eget schemaspråk (Anthropic: gemener; Gemini/OpenAPI: VERSALER). */
export interface CardField {
  name: string;
  type: "boolean" | "string" | "integer" | "number";
  description: string;
  enum?: string[];
}

export const CARD_FIELDS: CardField[] = [
  {
    name: "cardVisible",
    type: "boolean",
    description: "Syns ett Pokémon-kort tydligt i bilden?",
  },
  {
    name: "name",
    type: "string",
    description: "Kortets namn, t.ex. 'Charizard ex'. Tom sträng om okänt.",
  },
  {
    name: "number",
    type: "string",
    description:
      "Samlarnumret EXAKT som det står i nedre hörnet, med eventuell total: " +
      "'41/159', '4/102', 'TG10/TG30', 'GG08', 'SWSH034', 'SV075', '130a', 'MEP 074'. " +
      "Bokstäver före OCH efter siffrorna hör till numret och ska med. " +
      "Tom sträng om oläsligt.",
  },
  {
    name: "numberLegible",
    type: "boolean",
    description:
      "Kunde du läsa VARJE TECKEN i samlarnumret tydligt i bilden? " +
      "false om du gissade, härledde det ur kortets utseende, eller inte kunde se det.",
  },
  {
    name: "era",
    type: "string",
    enum: ["wotc", "ex", "dp", "bwxy", "sm", "swsh", "sv", "okand"],
    description:
      "Kortramens generation utifrån LAYOUTEN, inte ramfärgen (gul ram t.o.m. " +
      "2022): wotc = evolutionsruta uppe till vänster (1999–2003), ex = " +
      "STAGE-flik som överlappar konsten nere till vänster (2003–2007), " +
      "dp (2007–2011), bwxy (2011–2016), sm (2017–2019), swsh (2020–2022), " +
      "sv = silver/grå ram (2023–). Osäker = okand.",
  },
  {
    name: "hp",
    type: "integer",
    description:
      "Kortets HP — det stora talet uppe till höger intill 'HP' (t.ex. 90, " +
      "150, 220). 0 om det inte syns eller inte går att läsa säkert.",
  },
  { name: "confidence", type: "number", description: "0–1" },
];

export const CARD_REQUIRED = CARD_FIELDS.map((f) => f.name);

/**
 * Samlarnumret måste se ut som ett samlarnummer. Ett påhittat tal träffar en
 * riktig rad förr eller senare — katalogen har 20 563 kort.
 */
export function sanitizeNumber(raw: string): string {
  const s = raw.trim();
  if (s.length === 0 || s.length > 16) return "";
  // Tillåtna tecken och form: alfanumeriska grupper åtskilda av ETT mellanslag,
  // snedstreck eller bindestreck. Täcker "4/102", "TG07/TG30", "SWSH034",
  // "MEP 074", "130a", "SVP 041". Ett `<`, `"` eller `=` diskvalificerar direkt.
  if (!/^[A-Za-z0-9]+(?:[ /-][A-Za-z0-9]+)*$/.test(s)) return "";
  if ((s.match(/\//g) ?? []).length > 1) return "";
  if ((s.match(/ /g) ?? []).length > 1) return "";
  // Utan siffra är det bara ett kortnummer om det är kort — Unowns alfabet ("A",
  // "ONE"). Annars är det en MENING modellen skrivit i fältet ("inget nummer").
  if (!/\d/.test(s) && s.replace(/[^A-Za-z]/g, "").length > 4) return "";
  return s;
}

/** Samma skydd för namnet: markup eller radbrytningar är inte ett kortnamn. */
export function sanitizeName(raw: string): string {
  const s = raw.trim();
  if (s.length === 0 || s.length > 60) return "";
  return /[<>{}\n\r]/.test(s) ? "" : s;
}

/**
 * De råa verktygsfälten → OcrResult. ⛔ ALL tolkning bor här, inte i adaptrarna:
 * numret används bara när modellen SJÄLV säger att det var läsbart, HP kläms
 * mot tryckta värden, och "inget kort i bild" nollar konfidensen. Skiljer sig
 * det här mellan leverantörer mäter en A/B-jämförelse parsern, inte modellen.
 */
export function buildOcrResult(
  input: Record<string, unknown>,
  usage?: { inputTokens: number; outputTokens: number }
): OcrResult {
  const cardVisible = input.cardVisible === true;
  const name = sanitizeName(typeof input.name === "string" ? input.name : "");
  // Numret används BARA när modellen själv säger att det var läsbart. Ett
  // uppdiktat nummer är aktivt skadligt — det kan matcha ett riktigt kort och
  // vinna över rätt kort. Saknas fältet (äldre svar) faller vi tillbaka på att
  // lita på numret, dvs beteendet som fanns förut.
  const legible = input.numberLegible !== false;
  const number = legible
    ? sanitizeNumber(typeof input.number === "string" ? input.number : "")
    : "";
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? Math.min(1, Math.max(0, input.confidence))
      : 0.5;
  const era = typeof input.era === "string" && input.era !== "okand" ? input.era : undefined;
  // Tryckta HP är 30–340 i jämna 10-tal; allt annat är en felläsning och kastas
  // hellre än att den matchar fel kort exakt (samma princip som sanitizeNumber).
  const hpRaw = typeof input.hp === "number" ? Math.round(input.hp) : 0;
  const hp = hpRaw >= 30 && hpRaw <= 500 && hpRaw % 10 === 0 ? hpRaw : undefined;

  return {
    rawText: [name, number].filter(Boolean).join(" "),
    guessedName: cardVisible && name ? name : undefined,
    guessedNumber: cardVisible && number ? number : undefined,
    guessedEra: cardVisible ? era : undefined,
    guessedHp: cardVisible ? hp : undefined,
    // Inget kort i bild → 0 så att UI:t inte låser på en slumpträff.
    confidence: cardVisible ? confidence : 0,
    usage,
  };
}

/** Data-URL → (mediatyp, base64). Delas av adaptrarna. */
export function parseDataUrl(dataUrl: string): {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
} {
  const m = /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) {
    throw new ServiceError(400, "Bildformatet stöds inte. Använd JPG, PNG, WEBP eller GIF.");
  }
  const raw = m[1].toLowerCase();
  const mediaType = (raw === "image/jpg" ? "image/jpeg" : raw) as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";
  return { mediaType, data: m[2] };
}
