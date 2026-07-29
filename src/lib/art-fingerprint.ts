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
