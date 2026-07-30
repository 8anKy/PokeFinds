/**
 * KONSTAVTRYCK — ett kort identifieras på sitt UTSEENDE, inte på sin text.
 *
 * VARFÖR (mätt 2026-07-29): samlarnumret trycks ~2 mm högt. På en fysisk kortbild
 * går det att läsa, men i en skärmfotografering — eller ett foto med glans, skev
 * vinkel eller ett finger över hörnet — finns informationen helt enkelt inte i
 * bilden. Vision-modellen svarade då med kortets HP (stort, uppe till höger) eller
 * hittade på ett nummer. Ingen upplösning och ingen modell lagar det, för texten
 * saknas i källan.
 *
 * Avtrycket är HELA kortet nedskalat till ett 8×11-rutnät i RGB (264 tal), per
 * kanal standardiserat och kvantiserat till int8. Det är medvetet GROVT:
 *
 *   MÄTT över hela katalogen (20 431 referenser, 300 frågor, försämrade som
 *   skärmfotograferingar) — topp-15 var 100 % / 97,0 % (mild / hård försämring)
 *   för 8×11, men SÄMRE för finare rutnät: 98,3 % för 24×33. Fin detalj överlever
 *   inte en dålig bild, så den bidrar med brus i stället för signal. Det är också
 *   skälet att ett neuralt nät INTE valdes: dess styrka är finkorniga särdrag, och
 *   vi har mätt att finkorniga särdrag inte hjälper här. 264 tal räcker.
 *
 * ⛔ EN ENDA implementation, med flit. Avtrycket räknas av klienten (canvas) och
 * jämförs mot ett index byggt på servern (sharp). Två separata implementationer av
 * samma nyckel går isär tyst — precis fällan `Card.numberSortKey` och
 * `cardNumberSortKey()` har ett test för. Här tar vi bort risken helt: båda sidor
 * anropar den här funktionen med RÅA RGB-pixlar, och all aritmetik (inklusive
 * nedskalningen) görs här. Bibliotekens egna omsamplingsfilter (lanczos vs
 * webbläsarens utjämning) får aldrig ingå i nyckeln.
 */

export const GRID_W = 8;
export const GRID_H = 11;
/** 8×11 celler × RGB = 264 int8 per kort. Hela katalogen ≈ 5,4 MB. */
export const FINGERPRINT_BYTES = GRID_W * GRID_H * 3;

/** Standardavvikelser som får plats i int8. ±3σ täcker allt utom extremvärden. */
const CLAMP_SIGMA = 3;
const SCALE = 127 / CLAMP_SIGMA;

/**
 * INSET-SVEP — klientens svar på att ramen aldrig sitter tätt.
 *
 * Avtrycket är mycket känsligt för hur mycket bakgrund som omger kortet, eftersom
 * ytterringen av ett 8×11-rutnät är 34 av 88 celler. MÄTT (hård försämring, hela
 * katalogen som referens), topp-15 med ETT avtryck mot marginalen runt kortet:
 *   0 % → 96 %   1 % → 94 %   2 % → 84 %   4 % → 49 %   6 % → 15 %
 * En handhållen fångst sitter inte inom 1–2 %, så ett enda avtryck räcker inte.
 *
 * Klienten skickar därför avtrycket beskuret med flera inset och servern tar det
 * BÄSTA. Då spelar det nästan ingen roll hur kortet ligger i ramen — MÄTT med
 * dessa fyra inset:
 *   marginal 2 % → topp-15 96 %   4 % → 96 %   6 % → 97 %
 * (mot 94 / 47 / 9 % med ett enda avtryck).
 *
 * Kostnaden är försumbar: 4 × 264 byte upp och fyra sökningar à ~10 ms mot
 * indexet i minnet. Fler inset ger marginell vinst; färre tappar 4–6 %-fallet.
 */
export const FINGERPRINT_INSETS = [0, 0.03, 0.06, 0.09] as const;

/**
 * Råa RGB(A)-pixlar → konstavtryck.
 *
 * `channels` är 3 (sharp `.raw()` efter removeAlpha) eller 4 (canvas
 * `getImageData`). Nedskalningen är ett RENT BOXMEDELVÄRDE: varje cell är medelvärdet
 * av alla källpixlar inom sin ruta. Reproducerbart tecken för tecken i både JS-
 * miljöer, till skillnad från ett biblioteks omsamplingsfilter.
 *
 * Per-kanal standardisering (medel 0, std 1) gör avtrycket oberoende av
 * ljusstyrka och vitbalans — en monitor och en telefonkamera flyttar båda de
 * värdena, och utan detta hade avtrycket mest mätt färgtemperatur.
 */
export function fingerprintFromRgb(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4 = 3,
  /** Andel av varje kant som hoppas över. Se FINGERPRINT_INSETS. */
  inset = 0
): Int8Array | null {
  if (width < 1 || height < 1) return null;
  if (pixels.length < width * height * channels) return null;

  // Insetet räknas HÄR och inte genom att beskära bilden i förväg, så att
  // referens- och frågesidan delar exakt samma aritmetik.
  const dx = inset > 0 ? Math.round(width * inset) : 0;
  const dy = inset > 0 ? Math.round(height * inset) : 0;
  const x0 = dx;
  const y0 = dy;
  const iw = width - dx * 2;
  const ih = height - dy * 2;
  // Ett inset som äter upp bilden ger ingen information — avvisa i stället för
  // att räkna på en tom yta.
  if (iw < GRID_W || ih < GRID_H) return null;

  const cells = GRID_W * GRID_H;
  const sums = new Float64Array(cells * 3);
  const counts = new Uint32Array(cells);

  for (let y = 0; y < ih; y++) {
    // Heltalsdivision ger exakt samma cellgränser i båda implementationerna.
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / ih));
    const rowBase = (y0 + y) * width;
    for (let x = 0; x < iw; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor((x * GRID_W) / iw));
      const cell = gy * GRID_W + gx;
      const p = (rowBase + x0 + x) * channels;
      sums[cell * 3] += pixels[p];
      sums[cell * 3 + 1] += pixels[p + 1];
      sums[cell * 3 + 2] += pixels[p + 2];
      counts[cell]++;
    }
  }

  const out = new Int8Array(FINGERPRINT_BYTES);
  for (let c = 0; c < 3; c++) {
    // Medelvärde per cell för den här kanalen.
    const vals = new Float64Array(cells);
    for (let i = 0; i < cells; i++) {
      vals[i] = counts[i] > 0 ? sums[i * 3 + c] / counts[i] : 0;
    }
    let sum = 0;
    for (let i = 0; i < cells; i++) sum += vals[i];
    const mean = sum / cells;
    let varSum = 0;
    for (let i = 0; i < cells; i++) varSum += (vals[i] - mean) * (vals[i] - mean);
    // Enfärgad yta (std 0) skulle ge division med noll → allt blir 0, vilket är
    // korrekt: en helt jämn bild bär ingen information.
    const std = Math.sqrt(varSum / cells) || 1;
    for (let i = 0; i < cells; i++) {
      const z = (vals[i] - mean) / std;
      const q = Math.round(Math.max(-CLAMP_SIGMA, Math.min(CLAMP_SIGMA, z)) * SCALE);
      out[c * cells + i] = q;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// STRUKTURAVTRYCK — särdrag som överlever OMRENDERING (skärmfoto av en bild).
//
// VARFÖR (mätt 2026-07-30, scripts/art-audit/screen-eval.ts): färgavtrycket
// ovan fälls av RUMSLIGT varierande ljus — LCD:ns off-axis-avfall, vinjettering
// och blänk — som per-kanal-standardiseringen inte kan kancellera (den tar bara
// affina transformer). På en kalibrerad skärmfoto-benchmark som reproducerar
// produktionens verkliga haverier föll färgavtryckets topp-15 till 38,5 %.
// Konkurrenternas kortscanners (TinEye CardSearchEngine-klassen) bygger på
// belysningsimmun STRUKTUR, och det gör de två delarna här också:
//
//   DCTB — tecknet på lågfrekventa DCT-koefficienter (pHash-familjen). Ett
//          mjukt ljusfält stör koefficienternas VÄRDEN men sällan deras
//          TECKEN. 255 dim (16×16 minus DC) från en 64×64-gråskalegrid.
//   GRAD — orienterade gradienthistogram (HOG-lätt). Kanter i konst och ram
//          ligger kvar när färgtemperatur och moiré flyttar absolutvärdena.
//          8×11 celler × 8 riktningsfack = 704 dim från en 96×132-grid.
//
// MÄTT (205 frågor × 2 benchmarks, hela katalogen som distraktorer), topp-15
// med blandningen 0,25·färg + 0,25·dctb + 0,5·grad ("triw"):
//   skärmfoto  38,5 % → 97,1 %      fysisk (harsh)  93,2 % → 95,6 %
// Marginaler: fel-max 0,028 (410 frågor), rätt-median ~0,10–0,12 — samma
// marginalregel som förut fungerar, med större säkerhetsavstånd.
//
// ⛔ Samma enda-implementation-regel som färgavtrycket: klient (canvas, 4 kan)
// och server (sharp, 3 kan) anropar DEN HÄR koden med råa pixlar; all
// nedskalning är boxmedelvärde härifrån. Testet jämför vägarna byte för byte.
// ---------------------------------------------------------------------------

/** 16×16 lågfrekvens-DCT minus DC. */
export const STRUCT_DCT_DIMS = 255;
/** 8×11 celler × 8 riktningsfack. */
export const STRUCT_GRAD_DIMS = 704;
/** dctb (±1) följt av grad (int8) i EN buffert. */
export const STRUCT_BYTES = STRUCT_DCT_DIMS + STRUCT_GRAD_DIMS;

/** Blandningsvikter — mätt bäst balans (screen-eval "triw"). Summan = 1. */
export const BLEND_COLOR = 0.25;
export const BLEND_DCT = 0.25;
export const BLEND_GRAD = 0.5;

const DCT_N = 64;
const DCT_KEEP = 16;
const GRAD_W = 96;
const GRAD_H = 132;
const GRAD_CELLS_X = 8;
const GRAD_CELLS_Y = 11;
const GRAD_BINS = 8;

/** Förberäknad DCT-II-matris. Ren aritmetik → identisk i alla JS-miljöer. */
let dctMatrix: Float64Array | null = null;
function getDctMatrix(): Float64Array {
  if (dctMatrix) return dctMatrix;
  const m = new Float64Array(DCT_N * DCT_N);
  for (let k = 0; k < DCT_N; k++) {
    const a = k === 0 ? Math.sqrt(1 / DCT_N) : Math.sqrt(2 / DCT_N);
    for (let n = 0; n < DCT_N; n++) {
      m[k * DCT_N + n] = a * Math.cos(((2 * n + 1) * k * Math.PI) / (2 * DCT_N));
    }
  }
  dctMatrix = m;
  return m;
}

/**
 * Råa RGB(A)-pixlar → strukturavtryck (dctb ±1 + grad int8), eller null när
 * insetet äter upp bilden. Samma inset-semantik som färgavtrycket — svepet
 * (FINGERPRINT_INSETS) gäller båda.
 */
export function structFingerprintFromRgb(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4 = 3,
  inset = 0
): Int8Array | null {
  if (width < 1 || height < 1) return null;
  if (pixels.length < width * height * channels) return null;
  const dx = inset > 0 ? Math.round(width * inset) : 0;
  const dy = inset > 0 ? Math.round(height * inset) : 0;
  const iw = width - dx * 2;
  const ih = height - dy * 2;
  if (iw < GRAD_W / 2 || ih < GRAD_H / 2) return null;

  // EN pixelpassage fyller båda gråskalegriderna (64×64 + 96×132).
  const dctSums = new Float64Array(DCT_N * DCT_N);
  const dctCounts = new Uint32Array(DCT_N * DCT_N);
  const gradSums = new Float64Array(GRAD_W * GRAD_H);
  const gradCounts = new Uint32Array(GRAD_W * GRAD_H);
  for (let y = 0; y < ih; y++) {
    const dctGy = Math.min(DCT_N - 1, Math.floor((y * DCT_N) / ih));
    const gradGy = Math.min(GRAD_H - 1, Math.floor((y * GRAD_H) / ih));
    const rowBase = (dy + y) * width;
    for (let x = 0; x < iw; x++) {
      const p = (rowBase + dx + x) * channels;
      const lum = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
      const dctGx = Math.min(DCT_N - 1, Math.floor((x * DCT_N) / iw));
      const dctCell = dctGy * DCT_N + dctGx;
      dctSums[dctCell] += lum;
      dctCounts[dctCell]++;
      const gradGx = Math.min(GRAD_W - 1, Math.floor((x * GRAD_W) / iw));
      const gradCell = gradGy * GRAD_W + gradGx;
      gradSums[gradCell] += lum;
      gradCounts[gradCell]++;
    }
  }
  const dctGray = new Float64Array(DCT_N * DCT_N);
  for (let i = 0; i < dctGray.length; i++) {
    dctGray[i] = dctCounts[i] ? dctSums[i] / dctCounts[i] : 0;
  }
  const gradGray = new Float64Array(GRAD_W * GRAD_H);
  for (let i = 0; i < gradGray.length; i++) {
    gradGray[i] = gradCounts[i] ? gradSums[i] / gradCounts[i] : 0;
  }

  const out = new Int8Array(STRUCT_BYTES);

  // DCTB: separabel 2D-DCT, bara de DCT_KEEP lägsta frekvenserna behövs.
  const M = getDctMatrix();
  const rows = new Float64Array(DCT_N * DCT_KEEP);
  for (let y = 0; y < DCT_N; y++) {
    for (let u = 0; u < DCT_KEEP; u++) {
      let s = 0;
      for (let x = 0; x < DCT_N; x++) s += dctGray[y * DCT_N + x] * M[u * DCT_N + x];
      rows[y * DCT_KEEP + u] = s;
    }
  }
  let di = 0;
  for (let v = 0; v < DCT_KEEP; v++) {
    for (let u = 0; u < DCT_KEEP; u++) {
      if (u === 0 && v === 0) continue; // DC bär bara medelljus
      let s = 0;
      for (let y = 0; y < DCT_N; y++) s += rows[y * DCT_KEEP + u] * M[v * DCT_N + y];
      out[di++] = s >= 0 ? 1 : -1;
    }
  }

  // GRAD: centrala differenser på griden, magnitudviktade riktningsfack.
  const hist = new Float64Array(STRUCT_GRAD_DIMS);
  const cw = GRAD_W / GRAD_CELLS_X;
  const chh = GRAD_H / GRAD_CELLS_Y;
  for (let y = 1; y < GRAD_H - 1; y++) {
    for (let x = 1; x < GRAD_W - 1; x++) {
      const gx = gradGray[y * GRAD_W + x + 1] - gradGray[y * GRAD_W + x - 1];
      const gy = gradGray[(y + 1) * GRAD_W + x] - gradGray[(y - 1) * GRAD_W + x];
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag === 0) continue;
      let ang = Math.atan2(gy, gx);
      if (ang < 0) ang += Math.PI;
      const bin = Math.min(GRAD_BINS - 1, Math.floor((ang / Math.PI) * GRAD_BINS));
      const cellX = Math.min(GRAD_CELLS_X - 1, Math.floor(x / cw));
      const cellY = Math.min(GRAD_CELLS_Y - 1, Math.floor(y / chh));
      // Roten ur magnituden (Hellinger) dämpar enstaka hårda kanter.
      hist[(cellY * GRAD_CELLS_X + cellX) * GRAD_BINS + bin] += Math.sqrt(mag);
    }
  }
  // Kvantisering per vektor: cosinus är skalinvariant, så max-skalning till
  // ±127 behåller mest int8-upplösning. Determinism: samma flyttalsoperationer
  // i samma ordning på båda sidor.
  let maxAbs = 0;
  for (let i = 0; i < hist.length; i++) if (Math.abs(hist[i]) > maxAbs) maxAbs = Math.abs(hist[i]);
  const scale = maxAbs > 0 ? 127 / maxAbs : 0;
  for (let i = 0; i < hist.length; i++) {
    out[STRUCT_DCT_DIMS + i] = Math.round(hist[i] * scale);
  }
  return out;
}

/**
 * Avtryck → L2-normaliserad float-vektor för jämförelse.
 *
 * Normaliseringen görs vid JÄMFÖRELSEN och inte före kvantiseringen: int8 har mest
 * upplösning kvar när värdena spänner hela intervallet, och en L2-normaliserad
 * 264-dimensionell vektor har komponenter kring 0,06 — kvantiserad till int8 hade
 * den tappat merparten av sin precision.
 */
export function toUnitVector(fp: Int8Array | Uint8Array | Buffer): Float32Array {
  const n = fp.length;
  const v = new Float32Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    // Uint8Array/Buffer bär int8 som 0..255 — tolka om till tecken.
    const raw = fp instanceof Int8Array ? fp[i] : ((fp[i] << 24) >> 24);
    v[i] = raw;
    norm += raw * raw;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < n; i++) v[i] /= norm;
  return v;
}

/** Cosinuslikhet mellan två L2-normaliserade vektorer. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
