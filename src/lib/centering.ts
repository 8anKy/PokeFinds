/**
 * CENTRERINGSMÄTNING (2026-10-01, ägarbeslut) — ren matematik, ingen AI.
 *
 * Användaren lägger åtta stödlinjer på sitt eget foto: fyra på kortets YTTERKANT
 * och fyra på ramens INNERKANT. Kantbredden per sida = avståndet mellan dem, och
 * centreringen per axel = den bredaste sidans andel av summan ("55/45").
 *
 * ⛔ GRÄNSERNA ÄR PSA:s PUBLICERADE (psacard.com/gradingstandards, "approximately"):
 *    framsida 10 = 55/45, 9 = 60/40, 8 = 65/35, 7 = 70/30, 6 = 80/20, 5–4 = 85/15,
 *    därunder 90/10; baksida 10 = 75/25, annars 90/10. PSA 10 skärptes tyst från
 *    60/40 till 55/45 under 2025 — ändras de igen ändras BARA tabellerna här.
 *    Båda axlarna dömer var för sig: 50/50 i sidled hjälper inte 60/40 på höjden.
 *    Resultatet är ett TAK ("centreringen tillåter högst PSA 9"), aldrig en grad.
 *
 * ⛔ e-READER-KORT (Expedition, Aquapolis, Skyridge): framsidans VÄNSTER- och
 *    NEDERKANT är breddade för punktkodsremsan (Bulbapedia: "the left and bottom
 *    borders have been increased in size to incorporate the Dot Code"). De två
 *    sidorna säger alltså ingenting om hur kortet är skuret. Samlarnas metod är att
 *    jämföra de två RENA kanterna — ÖVRE och HÖGRA — som är lika breda på ett
 *    centrerat kort. Baksidan är en vanlig Pokémon-baksida och mäts som vanligt.
 */

export type CenteringSide = "front" | "back";

/** Linjernas lägen som ANDEL av bildens bredd (x) resp. höjd (y), 0..1. */
export interface CenteringLines {
  outerLeft: number;
  outerRight: number;
  outerTop: number;
  outerBottom: number;
  innerLeft: number;
  innerRight: number;
  innerTop: number;
  innerBottom: number;
}

export type CenteringLineKey = keyof CenteringLines;

export const LINE_KEYS: CenteringLineKey[] = [
  "outerLeft",
  "outerRight",
  "outerTop",
  "outerBottom",
  "innerLeft",
  "innerRight",
  "innerTop",
  "innerBottom",
];

export function isVerticalLine(key: CenteringLineKey): boolean {
  return key.endsWith("Left") || key.endsWith("Right");
}

/** Startläge: ett kort som fyller ~90 % av bilden med ~5 % ram. */
export function defaultLines(): CenteringLines {
  return {
    outerLeft: 0.05,
    outerRight: 0.95,
    outerTop: 0.04,
    outerBottom: 0.96,
    innerLeft: 0.1,
    innerRight: 0.9,
    innerTop: 0.08,
    innerBottom: 0.92,
  };
}

/** Kantbredder i BILDPIXLAR (behövs för e-Reader, som jämför sidled mot höjd). */
export interface Borders {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function bordersPx(lines: CenteringLines, width: number, height: number): Borders {
  return {
    left: Math.max(0, (lines.innerLeft - lines.outerLeft) * width),
    right: Math.max(0, (lines.outerRight - lines.innerRight) * width),
    top: Math.max(0, (lines.innerTop - lines.outerTop) * height),
    bottom: Math.max(0, (lines.outerBottom - lines.innerBottom) * height),
  };
}

/**
 * En axels centrering: andelen för respektive sida, i procent (summerar till 100).
 * `null` när kanterna saknas (båda 0) — då finns inget att mäta.
 */
export interface AxisRatio {
  /** Första sidans andel (vänster / övre). */
  a: number;
  /** Andra sidans andel (höger / nedre). */
  b: number;
}

export function axisRatio(first: number, second: number): AxisRatio | null {
  const sum = first + second;
  if (!(sum > 0)) return null;
  const a = (first / sum) * 100;
  return { a, b: 100 - a };
}

/** Den bredare sidans andel, 50..100 — talet gränserna jämförs mot. */
export function worstShare(r: AxisRatio): number {
  return Math.max(r.a, r.b);
}

/** "55/45" — bredaste sidan först, heltal (som samlarna och PSA skriver det). */
export function formatRatio(r: AxisRatio): string {
  const big = Math.round(worstShare(r));
  return `${big}/${100 - big}`;
}

export type CenteringMode = "standard" | "ereader";

export interface CenteringResult {
  side: CenteringSide;
  mode: CenteringMode;
  /** Vänster/höger. Saknas på e-Reader-framsidor. */
  leftRight: AxisRatio | null;
  /** Övre/nedre. Saknas på e-Reader-framsidor. */
  topBottom: AxisRatio | null;
  /** e-Reader-framsida: övre mot högra kanten. */
  topRight: AxisRatio | null;
  /** Högsta PSA-grad centreringen tillåter (tak, inte en grad). null = omätt. */
  psaCap: number | null;
  /** Högsta CGC-grad centreringen tillåter. null = omätt ELLER sämre än CGC:s publicerade gränser. */
  cgcCap: number | null;
  /** Högsta TAG-grad (TCG-gränserna). null = omätt ELLER sämre än TAG:s publicerade gränser. */
  tagCap: number | null;
}

/** Framsidans gränser, högsta grad först: [grad, största tillåtna andel]. */
const PSA_FRONT: [number, number][] = [
  [10, 55],
  [9, 60],
  [8, 65],
  [7, 70],
  [6, 80],
  [5, 85],
  [4, 85],
  [3, 90],
  [2, 90],
  [1, 100],
];

const PSA_BACK: [number, number][] = [
  [10, 75],
  [9, 90],
  [8, 90],
  [7, 90],
  [6, 90],
  [5, 90],
  [4, 90],
  [3, 90],
  [2, 90],
  [1, 100],
];

/**
 * Högsta PSA-grad en viss sämsta andel tillåter. Halv procentenhet tolerans:
 * PSA skriver "approximately", och linjerna läggs för hand på ett foto.
 */
export function psaCapFor(share: number, side: CenteringSide): number {
  const table = side === "front" ? PSA_FRONT : PSA_BACK;
  for (const [grade, limit] of table) {
    if (share <= limit + 0.5) return grade;
  }
  return 1;
}

/**
 * CGC:s publicerade gränser (cgccards.com/card-grading/grading-scale, läst 2026-11-21). Gem Mint 10:
 * "not to exceed approximately 55/45, and reverse centering … 75/25". 9 och nedåt står där "for sports
 * and non-sports cards" — CGC publicerar inga egna TCG-tal. Grader utan tal på sidan (9.5, 8.5, 5 …)
 * finns inte i tabellen: vi påstår aldrig en gräns CGC inte skrivit. Pristine 10 (50/50) är en etikett
 * ovanpå Gem Mint och visas inte som tak.
 */
const CGC_FRONT: [number, number][] = [
  [10, 55],
  [9, 60],
  [8, 65],
  [7, 70],
  [6, 75],
  [4.5, 85],
  [3.5, 90],
];
const CGC_BACK: [number, number][] = [
  [10, 75],
  [9, 90],
];

/**
 * TAG:s publicerade TCG-gränser (taggrading.com/pages/rubric, läst 2026-11-21): 10 "~55/45 and back image
 * within … ~65/35 (TCG)", 9 "~60/40 … ~75/25 (TCG)", 8 "~65/35. For TCG, backs … ~95/5". Under 8 publiceras
 * inga tal ⇒ null. (Beckett publicerar bara Pristine 10 officiellt, SGC inga tal — därför saknas de.)
 */
const TAG_FRONT: [number, number][] = [
  [10, 55],
  [9, 60],
  [8, 65],
];
const TAG_BACK: [number, number][] = [
  [10, 65],
  [9, 75],
  [8, 95],
];

function capFrom(table: [number, number][], share: number): number | null {
  for (const [grade, limit] of table) {
    if (share <= limit + 0.5) return grade;
  }
  return null;
}

export function tagCapFor(share: number, side: CenteringSide): number | null {
  return capFrom(side === "front" ? TAG_FRONT : TAG_BACK, share);
}

/** Högsta CGC-grad en sämsta andel tillåter; null = sämre än det CGC publicerat. */
export function cgcCapFor(share: number, side: CenteringSide): number | null {
  for (const [grade, limit] of side === "front" ? CGC_FRONT : CGC_BACK) {
    if (share <= limit + 0.5) return grade;
  }
  return null;
}

export function measureCentering(
  lines: CenteringLines,
  width: number,
  height: number,
  side: CenteringSide,
  mode: CenteringMode
): CenteringResult {
  const b = bordersPx(lines, width, height);
  if (side === "front" && mode === "ereader") {
    const topRight = axisRatio(b.top, b.right);
    return {
      side,
      mode,
      leftRight: null,
      topBottom: null,
      topRight,
      psaCap: topRight ? psaCapFor(worstShare(topRight), side) : null,
      cgcCap: topRight ? cgcCapFor(worstShare(topRight), side) : null,
      tagCap: topRight ? tagCapFor(worstShare(topRight), side) : null,
    };
  }
  const leftRight = axisRatio(b.left, b.right);
  const topBottom = axisRatio(b.top, b.bottom);
  const shares = [leftRight, topBottom].filter((r): r is AxisRatio => r != null).map(worstShare);
  return {
    side,
    // Baksidan på ett e-Reader-kort är en vanlig baksida.
    mode: side === "back" ? "standard" : mode,
    leftRight,
    topBottom,
    topRight: null,
    psaCap: shares.length === 2 ? psaCapFor(Math.max(...shares), side) : null,
    cgcCap: shares.length === 2 ? cgcCapFor(Math.max(...shares), side) : null,
    tagCap: shares.length === 2 ? tagCapFor(Math.max(...shares), side) : null,
  };
}

/** Taket för hela kortet: det strängaste av fram och bak. */
export function combinedPsaCap(results: (CenteringResult | null | undefined)[]): number | null {
  const caps = results.map((r) => r?.psaCap).filter((c): c is number => c != null);
  return caps.length ? Math.min(...caps) : null;
}

/** Ett bolags tak för hela kortet = strängaste sidan. En mätt sida sämre än bolagets tabell ⇒ null. */
function combinedCap(results: (CenteringResult | null | undefined)[], key: "cgcCap" | "tagCap"): number | null {
  const measured = results.filter((r): r is CenteringResult => r != null && r.psaCap != null);
  if (!measured.length || measured.some((r) => r[key] == null)) return null;
  return Math.min(...measured.map((r) => r[key] as number));
}
export const combinedCgcCap = (results: (CenteringResult | null | undefined)[]) => combinedCap(results, "cgcCap");
export const combinedTagCap = (results: (CenteringResult | null | undefined)[]) => combinedCap(results, "tagCap");

/**
 * e-Reader-seten i katalogen (mätt 2026-10-01: de enda med punktkodsremsa).
 * Matchar på setnamnet så både skannerns och graderingens katalogträff räcker.
 */
const EREADER_SETS = ["expedition", "aquapolis", "skyridge"];

export function isEReaderSet(setName: string | null | undefined): boolean {
  if (!setName) return false;
  const s = setName.toLowerCase();
  return EREADER_SETS.some((name) => s.includes(name));
}

/**
 * Kompakt text för modellen och delningsbilden, t.ex.
 * "framsida V/H 54/46, Ö/N 51/49" eller "framsida (e-Reader) övre/höger 52/48".
 */
export function centeringSummary(r: CenteringResult, lang: "sv" | "en" = "sv"): string {
  const sv = lang === "sv";
  const side = r.side === "front" ? (sv ? "framsida" : "front") : sv ? "baksida" : "back";
  if (r.topRight) {
    return `${side} (e-Reader) ${sv ? "övre/höger" : "top/right"} ${formatRatio(r.topRight)}`;
  }
  const parts: string[] = [];
  if (r.leftRight) parts.push(`${sv ? "V/H" : "L/R"} ${formatRatio(r.leftRight)}`);
  if (r.topBottom) parts.push(`${sv ? "Ö/N" : "T/B"} ${formatRatio(r.topBottom)}`);
  return `${side} ${parts.join(", ")}`;
}

/** Linjerna får aldrig korsa varandra eller lämna bilden. */
export function clampLine(lines: CenteringLines, key: CenteringLineKey, value: number): number {
  const gap = 0.004;
  const v = Math.min(1, Math.max(0, value));
  switch (key) {
    case "outerLeft":
      return Math.min(v, lines.innerLeft - gap);
    case "innerLeft":
      return Math.min(Math.max(v, lines.outerLeft + gap), lines.innerRight - gap);
    case "innerRight":
      return Math.min(Math.max(v, lines.innerLeft + gap), lines.outerRight - gap);
    case "outerRight":
      return Math.max(v, lines.innerRight + gap);
    case "outerTop":
      return Math.min(v, lines.innerTop - gap);
    case "innerTop":
      return Math.min(Math.max(v, lines.outerTop + gap), lines.innerBottom - gap);
    case "innerBottom":
      return Math.min(Math.max(v, lines.innerTop + gap), lines.outerBottom - gap);
    case "outerBottom":
      return Math.max(v, lines.innerBottom + gap);
  }
}

/**
 * STARTGISSNING ur bilden (frivillig — användaren flyttar alltid linjerna själv).
 * Letar den starkaste kanten i profilen av medelljusheten längs varje axel:
 * ytterkanten i de yttre 30 %, innerkanten mellan ytterkanten och 18 % in.
 * Ett skannat kort mot jämn bakgrund ger nästan exakta linjer; ett rörigt foto ger
 * en sämre start — men aldrig sämre än standardläget, som den faller tillbaka på.
 */
export function guessLines(gray: Float32Array | Uint8ClampedArray, width: number, height: number): CenteringLines {
  if (width < 40 || height < 40) return defaultLines();

  // Medelljushet per kolumn (mittre 60 % av höjden) och per rad (mittre 60 % av bredden).
  const col = new Float32Array(width);
  const row = new Float32Array(height);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.ceil(height * 0.8);
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) col[x] += gray[y * width + x];
  }
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += gray[y * width + x];
    row[y] = s;
  }
  for (let x = 0; x < width; x++) col[x] /= y1 - y0;
  for (let y = 0; y < height; y++) row[y] /= x1 - x0;

  const edgeIn = (p: Float32Array, from: number, to: number): number => {
    let best = from;
    let bestVal = -1;
    const step = from <= to ? 1 : -1;
    for (let i = from; i !== to; i += step) {
      if (i < 1 || i >= p.length - 1) continue;
      const g = Math.abs(p[i + 1] - p[i - 1]);
      if (g > bestVal) {
        bestVal = g;
        best = i;
      }
    }
    return best;
  };

  const oL = edgeIn(col, 1, Math.floor(width * 0.3));
  const oR = edgeIn(col, width - 2, Math.ceil(width * 0.7));
  const oT = edgeIn(row, 1, Math.floor(height * 0.3));
  const oB = edgeIn(row, height - 2, Math.ceil(height * 0.7));
  const cardW = oR - oL;
  const cardH = oB - oT;
  if (cardW < width * 0.3 || cardH < height * 0.3) return defaultLines();

  // Innerkanten: hoppa förbi själva ytterkanten (1,5 % av kortet) och sök till 9 %
  // in. Ramar är ~3–6 % av kortet; längre in hittade gissningen namnraden (prövat
  // 2026-10-01 med 18 %). e-Reader-kortens breda punktkodskanter faller utanför —
  // de räknas ändå inte.
  const skipX = Math.max(2, Math.round(cardW * 0.015));
  const skipY = Math.max(2, Math.round(cardH * 0.015));
  // FÖRSTA starka kanten inåt, inte den starkaste: på fullbildskort är ramens
  // innerkant svagare än namnraden strax innanför (prövat 2026-10-01).
  const firstEdge = (p: Float32Array, from: number, to: number): number => {
    const step = from <= to ? 1 : -1;
    let max = 0;
    for (let i = from; i !== to; i += step) {
      if (i < 1 || i >= p.length - 1) continue;
      max = Math.max(max, Math.abs(p[i + 1] - p[i - 1]));
    }
    if (max === 0) return from;
    for (let i = from; i !== to; i += step) {
      if (i < 1 || i >= p.length - 1) continue;
      const g = Math.abs(p[i + 1] - p[i - 1]);
      // Toppen av den första kanten över halva maxstyrkan.
      if (g >= max * 0.5) {
        let best = i;
        let j = i;
        while (j !== to && j >= 1 && j < p.length - 1 && Math.abs(p[j + 1] - p[j - 1]) >= max * 0.5) {
          if (Math.abs(p[j + 1] - p[j - 1]) > Math.abs(p[best + 1] - p[best - 1])) best = j;
          j += step;
        }
        return best;
      }
    }
    return from;
  };
  const iL = firstEdge(col, oL + skipX, oL + Math.round(cardW * 0.09));
  const iR = firstEdge(col, oR - skipX, oR - Math.round(cardW * 0.09));
  const iT = firstEdge(row, oT + skipY, oT + Math.round(cardH * 0.09));
  const iB = firstEdge(row, oB - skipY, oB - Math.round(cardH * 0.09));

  const lines: CenteringLines = {
    outerLeft: oL / width,
    outerRight: oR / width,
    outerTop: oT / height,
    outerBottom: oB / height,
    innerLeft: iL / width,
    innerRight: iR / width,
    innerTop: iT / height,
    innerBottom: iB / height,
  };
  const sane =
    lines.outerLeft < lines.innerLeft &&
    lines.innerLeft < lines.innerRight &&
    lines.innerRight < lines.outerRight &&
    lines.outerTop < lines.innerTop &&
    lines.innerTop < lines.innerBottom &&
    lines.innerBottom < lines.outerBottom;
  return sane ? lines : defaultLines();
}
