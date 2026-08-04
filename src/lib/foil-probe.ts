/**
 * FOLIESOND — INSTRUMENTERING, INTE EN DETEKTOR.
 *
 * Frågan (ägaren 2026-08-04): kan skannern välja rätt VARIANT (standard /
 * reverse holo) själv, utan AI-kostnad? Signalen finns rimligen och all
 * matematik är gratis — men den är OMÄTT, och därför väljer den här koden
 * INGENTING. Den räknar tre tal per skanning och lägger dem i admin-
 * diagnostiken, så att frågan kan BESVARAS med mätdata i stället för
 * rimlighet.
 *
 * ⛔ Skeppa aldrig en foliedetektor på rimlighet. Ett fel variantval är TYST
 * (fel produkt, fel pris i samlingen) och användaren slutar dubbelkolla just
 * för att det oftast stämmer — samma fälla som de tre rivna prisvakterna
 * (project_lowest_near_mint_unreliable_ceiling). Kravet innan något AUTOMATISKT
 * val byggs är detsamma som för bildmatchningen: en MARGINALREGEL med uppmätt
 * precision, inte en poäng som "brukar" stämma. Reverse holo är dessutom
 * minoritetsklass, så en detektor som alltid gissar "standard" får ~90 % rätt
 * och är ändå värdelös.
 *
 * VARFÖR ODDSEN ÄR HYFSADE: vi vet VILKET KORT det är innan foliefrågan
 * ställs. Problemet är alltså inte "klassificera folie" utan "jämför mot det
 * här kortets kända platta katalogrendering" — och den referensen har vi redan
 * (`Card.artFingerprint`).
 *
 * SONDEN mäter samma 8×11-rutnät som konstavtrycket, med samma cellgränser och
 * samma inset-semantik, så cell i här är cell i där. Fyra tal per cell:
 *
 *   lum      medelluminans          — exponering/ljus
 *   lumStd   luminansspridning      — sparkle/textur inuti cellen
 *   clip     andel utbrända pixlar  — spekulära reflexer
 *   chroma   medelkroma (max−min)   — färgsplittring i folien
 *
 * 88 celler × 4 = 352 byte per sond. Klienten skickar dem uppåt bredvid
 * avtrycket; ingen bild lagras, precis som förut.
 */
import { GRID_H, GRID_W } from "./art-fingerprint";

export const PROBE_CELLS = GRID_W * GRID_H;
export const PROBE_CHANNELS = 4;
export const PROBE_BYTES = PROBE_CELLS * PROBE_CHANNELS;

/** Kanalordning i sonden (kanal-major, som konstavtrycket). */
export const PROBE_LUM = 0;
export const PROBE_LUMSTD = 1;
export const PROBE_CLIP = 2;
export const PROBE_CHROMA = 3;

/** Minsta kanalvärde för att en pixel ska räknas som utbränd (spekulär). */
const CLIP_MIN = 245;

/**
 * Råa RGB(A)-pixlar → foliesond, eller null när ytan är för liten.
 *
 * ⛔ Geometrin (inset, cellgränser, heltalsdivision) är AVSIKTLIGT identisk med
 * `fingerprintFromRgb`. Går de isär pekar cell 37 i sonden på en annan del av
 * kortet än cell 37 i avtrycket, och varje jämförelse mellan dem blir nonsens
 * utan att något kastar. Testet jämför cellindelningen mellan de två.
 */
export function foilProbeFromRgb(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4 = 3,
  inset = 0
): Uint8Array | null {
  if (width < 1 || height < 1) return null;
  if (pixels.length < width * height * channels) return null;

  const dx = inset > 0 ? Math.round(width * inset) : 0;
  const dy = inset > 0 ? Math.round(height * inset) : 0;
  const iw = width - dx * 2;
  const ih = height - dy * 2;
  if (iw < GRID_W || ih < GRID_H) return null;

  const sumLum = new Float64Array(PROBE_CELLS);
  const sumLum2 = new Float64Array(PROBE_CELLS);
  const sumChroma = new Float64Array(PROBE_CELLS);
  const clipped = new Uint32Array(PROBE_CELLS);
  const counts = new Uint32Array(PROBE_CELLS);

  for (let y = 0; y < ih; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / ih));
    const rowBase = (dy + y) * width;
    for (let x = 0; x < iw; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor((x * GRID_W) / iw));
      const cell = gy * GRID_W + gx;
      const p = (rowBase + dx + x) * channels;
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sumLum[cell] += lum;
      sumLum2[cell] += lum * lum;
      // Kroma som max−min: billigt, och det är SPLITTRINGEN vi är ute efter,
      // inte var på färgcirkeln den ligger.
      const max = r > g ? (r > b ? r : b) : g > b ? g : b;
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      sumChroma[cell] += max - min;
      // Utbränd = ALLA kanaler höga. Ett mättat gult fält har hög R och G men
      // låg B och är inte en reflex.
      if (min >= CLIP_MIN) clipped[cell]++;
      counts[cell]++;
    }
  }

  const out = new Uint8Array(PROBE_BYTES);
  for (let i = 0; i < PROBE_CELLS; i++) {
    const n = counts[i];
    if (n === 0) continue;
    const mean = sumLum[i] / n;
    const variance = Math.max(0, sumLum2[i] / n - mean * mean);
    out[PROBE_LUM * PROBE_CELLS + i] = Math.round(Math.min(255, mean));
    out[PROBE_LUMSTD * PROBE_CELLS + i] = Math.round(Math.min(255, Math.sqrt(variance)));
    out[PROBE_CLIP * PROBE_CELLS + i] = Math.round((clipped[i] / n) * 255);
    out[PROBE_CHROMA * PROBE_CELLS + i] = Math.round(Math.min(255, sumChroma[i] / n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// KONSTFÖNSTER kontra KORTKROPP
//
// Reverse holo lägger folien ÖVERALLT UTOM i konstfönstret; en holo rare gör
// tvärtom. Det är hela skälet att en per-cell-uppdelning kan bära signalen: de
// två varianterna ska avvika i MOTSATTA regioner mot samma platta referens.
//
// Rutnätet är 8×11, så cellcentrum ligger på x = 0,0625 … 0,9375 och
// y = 0,045 … 0,955. Ett klassiskt ramat kort har konstfönstret ungefär inom
// x ∈ [0,08 · 0,92] och y ∈ [0,12 · 0,50] ⇒ kolumn 1–6, rad 1–4 (24 celler).
// Rad 5 (centrum 0,50) ligger på gränsen och räknas till INGENDERA regionen —
// hellre 24 rena konstceller än 30 blandade.
//
// ⚠️ FULL ART-KORT HAR INGEN KROPP i den här meningen: konsten går ut i kanten
// och under texten. Masken är då fel, och det är en av sakerna mätningen ska
// avgöra — därför rapporteras regionerna var för sig, aldrig bara kvoten.
// ---------------------------------------------------------------------------

/** true = cellen ligger i konstfönstret, false = kortkropp, null = gränsrad. */
export function cellRegion(cell: number): "art" | "body" | null {
  const gx = cell % GRID_W;
  const gy = Math.floor(cell / GRID_W);
  if (gy >= 1 && gy <= 4) return gx >= 1 && gx <= 6 ? "art" : "body";
  if (gy === 5) return null; // konstfönstrets underkant — tvetydig
  return "body";
}

const ART_CELLS: number[] = [];
const BODY_CELLS: number[] = [];
for (let i = 0; i < PROBE_CELLS; i++) {
  const r = cellRegion(i);
  if (r === "art") ART_CELLS.push(i);
  else if (r === "body") BODY_CELLS.push(i);
}

export { ART_CELLS, BODY_CELLS };

/** Kvot som aldrig ljuger: nämnare ~0 ger null, inte Infinity. */
function ratio(a: number, b: number): number | null {
  return b > 1e-6 ? round(a / b) : null;
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export type RegionPair = {
  art: number;
  body: number;
  /** body / art. >1 = kortkroppen avviker mest (reverse holo-hypotesen). */
  ratio: number | null;
}

/**
 * SIGNAL 1 — KROPP MOT KONST, mot kortets EGEN referens.
 *
 * Per cell: avståndet mellan fångstens och katalogrenderingens färgavtryck.
 * Båda är per-kanal standardiserade, så talen är jämförbara trots att den ena
 * är en skärmrendering och den andra ett kamerafoto. KVOTEN normaliserar bort
 * exponeringen — det är annars precis det som brukar sänka sådana här mått.
 *
 * Detta är den starkaste av de tre, eftersom den är PER KORT och inte en blind
 * klassificerare.
 */
export function deviationByRegion(query: Int8Array, reference: Int8Array): RegionPair | null {
  if (query.length !== PROBE_CELLS * 3 || reference.length !== PROBE_CELLS * 3) return null;
  const dist = (cell: number) => {
    let s = 0;
    for (let c = 0; c < 3; c++) {
      const d = query[c * PROBE_CELLS + cell] - reference[c * PROBE_CELLS + cell];
      s += d * d;
    }
    return Math.sqrt(s);
  };
  const art = mean(ART_CELLS.map(dist));
  const body = mean(BODY_CELLS.map(dist));
  return { art: round(art), body: round(body), ratio: ratio(body, art) };
}

/**
 * SIGNAL 2 — TEMPORAL VARIANS.
 *
 * Spekulära reflexer RÖR SIG när kortet gör det; tryckfärg gör det inte.
 *
 * ⛔ Slutarens extra rutor duger INTE till detta: de tas med
 * `requestAnimationFrame`, alltså ~16 ms isär — kortet hinner inte röra sig.
 * Källan är LIVE-POLLEN (var 600:e ms, ≥3 pollar innan auto-fångsten löser ut),
 * dvs ~2 s handhållen rörelse som redan räknas och sedan kastas.
 *
 * Måttet är luminansens spridning över tid per cell, normaliserad med cellens
 * medelnivå (annars mäter det bara att ljusa celler har större absolut brus).
 */
export function temporalByRegion(probes: Uint8Array[]): (RegionPair & { frames: number }) | null {
  const usable = probes.filter((p) => p.length === PROBE_BYTES);
  if (usable.length < 2) return null;
  const perCell = (cell: number) => {
    const idx = PROBE_LUM * PROBE_CELLS + cell;
    let s = 0;
    let s2 = 0;
    for (const p of usable) {
      s += p[idx];
      s2 += p[idx] * p[idx];
    }
    const m = s / usable.length;
    const v = Math.max(0, s2 / usable.length - m * m);
    // Normalisering mot medelnivån: en mörk cell och en ljus cell ska kunna
    // jämföras. Golvet på 8 hindrar att nästan svarta celler exploderar.
    return Math.sqrt(v) / Math.max(8, m);
  };
  const art = mean(ART_CELLS.map(perCell));
  const body = mean(BODY_CELLS.map(perCell));
  return {
    art: round(art),
    body: round(body),
    ratio: ratio(body, art),
    frames: usable.length,
  };
}

export type SpecularStats = {
  clip: RegionPair;
  texture: RegionPair;
  chroma: RegionPair;
}

/**
 * SIGNAL 3 — SPEKULÄR KLIPPNING och TEXTUR i celler som referensen säger är
 * platt färg. Utbrända nästan-vita pixlar, inomcellsspridning och kroma.
 */
export function specularByRegion(probe: Uint8Array): SpecularStats | null {
  if (probe.length !== PROBE_BYTES) return null;
  const pair = (channel: number, scale = 1): RegionPair => {
    const at = (cell: number) => probe[channel * PROBE_CELLS + cell] * scale;
    const art = mean(ART_CELLS.map(at));
    const body = mean(BODY_CELLS.map(at));
    return { art: round(art), body: round(body), ratio: ratio(body, art) };
  };
  return {
    clip: pair(PROBE_CLIP, 1 / 255),
    texture: pair(PROBE_LUMSTD),
    chroma: pair(PROBE_CHROMA),
  };
}

export type FoilMetrics = {
  /** Kropp-mot-konst-avvikelse mot kortets egen katalogreferens. */
  dev: RegionPair | null;
  /** Luminansens rörelse över live-pollens rutor. */
  temporal: (RegionPair & { frames: number }) | null;
  /** Klippning, textur och kroma per region i fångsten. */
  spec: SpecularStats | null;
}

/** Alla tre signalerna i ett svep. Saknad indata ⇒ null för den delen, aldrig 0. */
export function foilMetrics(input: {
  probe: Uint8Array | null;
  history?: Uint8Array[];
  queryFingerprint?: Int8Array | null;
  referenceFingerprint?: Int8Array | null;
}): FoilMetrics {
  const { probe, history = [], queryFingerprint, referenceFingerprint } = input;
  return {
    dev:
      queryFingerprint && referenceFingerprint
        ? deviationByRegion(queryFingerprint, referenceFingerprint)
        : null,
    temporal: temporalByRegion(probe ? [...history, probe] : history),
    spec: probe ? specularByRegion(probe) : null,
  };
}

/** Klientens sond-nyttolast. Fälten är valfria hela vägen — en galleriuppladdning
 *  har varken sond eller pollhistorik, och ska fungera exakt som förut. */
export type FoilSample = {
  /** Sonden för den fångade rutan (base64, PROBE_BYTES). */
  probe: string;
  /** Sonderna från de senaste live-pollarna, äldst först. */
  history: string[];
}
