/**
 * LOKAL NUMMERLÄSNING — tolkar texten en ON-DEVICE OCR (ML Kit i appen) läste
 * ur kortets nederkantsremsa till ett samlarnummer.
 *
 * ⛔ **VARFÖR DEN HÄR FILEN FINNS (ägarmål 2026-08-30: skanner utan Gemini).**
 * Numret är kortets identitet (rules/scanner.md): bilden ger konsten, numret
 * skiljer omtryck och samma-konst-tvillingar. Den enda gratis källan till
 * numret som mätts duga är on-device-OCR i appen — tesseract i WebView:en
 * mätte 25,6/44,2 % exakt på riktiga remsor mot Geminis 94,9 % och ska inte
 * itereras (project_scanner_field_fingerprints_and_free_ocr).
 *
 * REN FUNKTION, delad av klienten (skanna/page.tsx via lib/mlkit-number.ts)
 * och mätskriptet (scripts/scanner-number-ocr-eval.ts --mlkit). Servern tolkar
 * ALDRIG om — den bokför det klienten skickade, så att en parserändring inte
 * kan skriva om historiken tyst.
 *
 * ⛔ INGET LOOKBEHIND i regexarna: appens WebView går ner till iOS 15, där
 * `(?<!…)` är ett SyntaxError vid modulladdning — hela skannersidan hade dött,
 * inte bara läsningen. Förtecknet fångas som en egen grupp i stället.
 */

export interface LocalNumberRead {
  /**
   * Tryckt nummer i SAMMA form som `parseGuessedNumber().printed`: prefix +
   * siffror UTAN ledande nollor + suffix ("143", "TG10", "SV75", "130a").
   * Jämförs mot katalogen via `cardNumberSortKey`, precis som Geminis läsning.
   */
  printed: string;
  /** Talet i numret. Null när numret saknar siffror (Unowns "H"). */
  num: number | null;
  /** Setets total efter snedstrecket, när OCR:n läste hela "n/N". */
  total: number | null;
}

export interface StripTextAnalysis {
  /** Bästa tolkningen, eller null när texten inte bar något samlarnummer. */
  number: LocalNumberRead | null;
  /**
   * Hur många "n/N"-kandidater texten bar. Fler än en = tvetydig remsa
   * (t.ex. en plastficka med ett annat kort skymtande) — bokförs så att
   * "läste fel" och "läste två" går att skilja åt i mätningen.
   */
  candidates: number;
}

/**
 * "n/N" med valfritt bokstavsprefix på båda sidor: "042/165", "TG10/TG30",
 * "SV075/SV198", "130a/132", "GG08/GG70". Tecknet FÖRE prefixet fångas
 * (grupp 1) i stället för ett lookbehind — se filhuvudet. Prefixet är
 * VERSALER direkt intill siffrorna: "Sugimori 042/165" får då inte "imori"
 * som prefix, vilket en fri `[A-Za-z]{0,5}\s*` gav.
 */
const SLASH_FORM = /(^|[^A-Za-z0-9])([A-Z]{1,4})?(\d{1,4})([a-z])?\s*[/／]\s*(?:[A-Z]{1,4})?(\d{1,4})/g;

/**
 * Promonummer utan total: "SWSH034", "SVP 048", "SM210", "XY67", "BW50".
 * Bara kända prefix — en fri bokstavsgrupp hade gjort "Illus 2023" till ett
 * nummer. Tas bara när ingen "n/N"-form finns.
 */
const PROMO_FORM = /(^|[^A-Za-z0-9])(SWSH|SVP|SV|SM|XY|BW|DP|HGSS|TG|GG|MEP|RC)\s?(\d{2,3})(?![0-9/／])/g;

/** Årtal ur copyrightraden ("©2023 Pokémon") ser ut som en total — och är det inte. */
const YEAR_MIN = 1990;

function stripLeadingZeros(digits: string): string {
  const s = digits.replace(/^0+/, "");
  return s === "" ? "0" : s;
}

interface Candidate extends LocalNumberRead {
  score: number;
}

/**
 * Tolkar OCR-texten. Vid flera kandidater väljs den som ser mest ut som ett
 * samlarnummer: num ≤ total (secret rares bryter det — de tas ändå, men
 * efter), total i ett rimligt setintervall, aldrig ett årtal.
 */
export function analyzeStripText(text: string): StripTextAnalysis {
  const found: Candidate[] = [];
  SLASH_FORM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLASH_FORM.exec(text))) {
    const prefix = m[2] ?? "";
    const num = parseInt(m[3], 10);
    const total = parseInt(m[5], 10);
    const suffix = m[4] ?? "";
    // "1/2" och "25/2023" är brus, inte nummer.
    if (total < 5 || total >= YEAR_MIN) continue;
    let score = 0;
    if (num <= total) score += 2;
    if (total >= 20 && total <= 400) score += 1;
    found.push({
      printed: `${prefix}${stripLeadingZeros(m[3])}${suffix}`,
      num,
      total,
      score,
    });
  }
  if (found.length > 0) {
    // Stabil sortering: högst poäng vinner, vid lika den som lästes först.
    const best = found.reduce((a, b) => (b.score > a.score ? b : a));
    return { number: { printed: best.printed, num: best.num, total: best.total }, candidates: found.length };
  }

  PROMO_FORM.lastIndex = 0;
  const p = PROMO_FORM.exec(text);
  if (p) {
    return {
      number: { printed: `${p[2]}${stripLeadingZeros(p[3])}`, num: parseInt(p[3], 10), total: null },
      candidates: 1,
    };
  }
  return { number: null, candidates: 0 };
}

/**
 * Japansk skrift i texten (hiragana, katakana, CJK). ⚠️ ML Kits LATIN-modell
 * (den vi kör) läser inte kana — den hoppar över eller gissar latinska tecken.
 * Flaggan blir alltså i praktiken sann bara om en JAPANSK igenkänning körts
 * (`script: Japanese`, egen modell). Ligger här för att språkfrågan (EN/JP-
 * tvillingen) ska ha en färdig avläsning den dag den passen byggs — inte för
 * att den mäter något i dag.
 */
export function hasJapaneseScript(text: string): boolean {
  return /[぀-ヿ㐀-䶿一-鿿]/.test(text);
}
