/**
 * SKÄRMFOTO-KANDIDATER — deskriptorer som INTE bygger på färglayout.
 *
 * Bakgrund (2026-07-30): replay av riktiga skanningar visade att färg-gridens
 * topp-5 nästan ALDRIG innehåller rätt kort för klassiskt ramade kort på
 * skärmfoto — färgen mättas inom en familj (tio blå vattenkort inom 0,05).
 * Konkurrenter (TinEye CardSearchEngine-klassen) klarar samma fall därför att
 * deras särdrag bygger på LOKALA GRADIENTER/STRUKTUR, som överlever
 * omrendering (monitor + moiré + färgstick) där absolutfärg inte gör det.
 *
 * Alla kandidater bygger på BOXMEDELVÄRDE från nativ upplösning — samma
 * portabla aritmetik som produktionens fingerprintFromRgb — så en vinnare kan
 * implementeras identiskt i klientens canvas utan resamplingsfilter-avvikelser.
 */
import sharp from "sharp";

/** Boxmedelvärdad GRÅSKALE-grid (luminans) från rå RGB. Portabel aritmetik. */
export function boxMeanGray(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number,
  gw: number,
  gh: number
): Float64Array {
  const sums = new Float64Array(gw * gh);
  const counts = new Uint32Array(gw * gh);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, Math.floor((y * gh) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / width));
      const p = (y * width + x) * channels;
      // Rec. 601-luma — samma koefficienter finns att räkna i canvas-JS.
      const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      const cell = gy * gw + gx;
      sums[cell] += lum;
      counts[cell]++;
    }
  }
  const out = new Float64Array(gw * gh);
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? sums[i] / counts[i] : 0;
  return out;
}

function l2(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

// ---------- DCT-kandidaterna (struktur i lågfrekvens, immun mot färgstick) ----

const DCT_N = 64;
const DCT_KEEP = 16; // lågfrekvensblocket 16×16 minus DC → 255 dimensioner

/** Förberäknad DCT-II-matris (N×N). */
const DCT_M = (() => {
  const m = new Float64Array(DCT_N * DCT_N);
  for (let k = 0; k < DCT_N; k++) {
    const a = k === 0 ? Math.sqrt(1 / DCT_N) : Math.sqrt(2 / DCT_N);
    for (let n = 0; n < DCT_N; n++) {
      m[k * DCT_N + n] = a * Math.cos(((2 * n + 1) * k * Math.PI) / (2 * DCT_N));
    }
  }
  return m;
})();

/** 2D-DCT av en 64×64-grid → lågfrekvenskoefficienter (u,v < 16, utan DC). */
function dctLowFreq(gray: Float64Array): Float64Array {
  // Separabel: rader först, sedan kolumner — bara de DCT_KEEP första behövs.
  const rows = new Float64Array(DCT_N * DCT_KEEP);
  for (let y = 0; y < DCT_N; y++) {
    for (let u = 0; u < DCT_KEEP; u++) {
      let s = 0;
      for (let x = 0; x < DCT_N; x++) s += gray[y * DCT_N + x] * DCT_M[u * DCT_N + x];
      rows[y * DCT_KEEP + u] = s;
    }
  }
  const out = new Float64Array(DCT_KEEP * DCT_KEEP);
  for (let v = 0; v < DCT_KEEP; v++) {
    for (let u = 0; u < DCT_KEEP; u++) {
      let s = 0;
      for (let y = 0; y < DCT_N; y++) s += rows[y * DCT_KEEP + u] * DCT_M[v * DCT_N + y];
      out[v * DCT_KEEP + u] = s;
    }
  }
  return out;
}

/** DCT-koefficienter L2-normerade (kontinuerlig variant). */
export function dctDescriptor(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number
): Float32Array {
  const gray = boxMeanGray(data, width, height, channels, DCT_N, DCT_N);
  const coeffs = dctLowFreq(gray);
  const out = new Float32Array(DCT_KEEP * DCT_KEEP - 1);
  for (let i = 1; i < coeffs.length; i++) out[i - 1] = coeffs[i];
  return l2(out);
}

/** Tecken-binariserad DCT (pHash-klassen): ±1 per koefficient, L2-normerad. */
export function dctSignDescriptor(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number
): Float32Array {
  const gray = boxMeanGray(data, width, height, channels, DCT_N, DCT_N);
  const coeffs = dctLowFreq(gray);
  const out = new Float32Array(DCT_KEEP * DCT_KEEP - 1);
  for (let i = 1; i < coeffs.length; i++) out[i - 1] = coeffs[i] >= 0 ? 1 : -1;
  return l2(out);
}

// ---------- Gradient-griden (HOG-lätt — lokal struktur, TinEye-familjen) -----

const G_W = 96;
const G_H = 132;
const G_CELLS_X = 8;
const G_CELLS_Y = 11;
const G_BINS = 8;

/**
 * Orienterade gradienthistogram: 8×11 celler × 8 riktningsfack = 704 dim.
 * Gradienter är det som överlever omrendering — kanter i konsten och ramen
 * ligger kvar när färgtemperatur, ljusstyrka och moiré flyttar absolutvärdena.
 * Roten ur magnituden (Hellinger-tricket) dämpar enstaka hårda kanter.
 */
export function gradDescriptor(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number
): Float32Array {
  const gray = boxMeanGray(data, width, height, channels, G_W, G_H);
  const out = new Float32Array(G_CELLS_X * G_CELLS_Y * G_BINS);
  const cw = G_W / G_CELLS_X;
  const ch = G_H / G_CELLS_Y;
  for (let y = 1; y < G_H - 1; y++) {
    for (let x = 1; x < G_W - 1; x++) {
      const gx = gray[y * G_W + x + 1] - gray[y * G_W + x - 1];
      const gy = gray[(y + 1) * G_W + x] - gray[(y - 1) * G_W + x];
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag === 0) continue;
      // Osignerad riktning 0..π i G_BINS fack.
      let ang = Math.atan2(gy, gx);
      if (ang < 0) ang += Math.PI;
      const bin = Math.min(G_BINS - 1, Math.floor((ang / Math.PI) * G_BINS));
      const cellX = Math.min(G_CELLS_X - 1, Math.floor(x / cw));
      const cellY = Math.min(G_CELLS_Y - 1, Math.floor(y / ch));
      out[(cellY * G_CELLS_X + cellX) * G_BINS + bin] += Math.sqrt(mag);
    }
  }
  return l2(out);
}

// ---------- Omrenderings-artefakter som harsh-profilen saknar ----------------

/**
 * Moiré + färgstick — det en monitor-fotografering lägger på som
 * degradeAsScreenPhoto inte modellerar (dess egen doc säger det uttryckligen).
 *
 * Två sinusband: ett fint (subpixelraster ~2,5–4,5 px) och ett grovt
 * (interferens 15–45 px — de synliga banden i skärmfoton). Per-kanal-gain är
 * monitorns färgtemperatur mot kamerans vitbalans — exakt det som mättar
 * färg-griden inom en färgfamilj.
 */
export async function addScreenArtifacts(buf: Buffer, seed: number): Promise<Buffer | null> {
  const rnd = (i: number) => {
    const x = Math.sin(seed * 15731 + i * 789221) * 43758.5453;
    return x - Math.floor(x);
  };
  try {
    const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = raw.info;
    const d = raw.data;

    const gains = [0.9 + rnd(1) * 0.2, 0.94 + rnd(2) * 0.12, 0.9 + rnd(3) * 0.2];
    const fineP = 2.5 + rnd(4) * 2.0;
    const fineA = 0.05 + rnd(5) * 0.07;
    const fineTh = rnd(6) * Math.PI;
    const coarseP = 15 + rnd(7) * 30;
    const coarseA = 0.03 + rnd(8) * 0.05;
    const coarseTh = rnd(9) * Math.PI;
    const cosF = Math.cos(fineTh) / fineP;
    const sinF = Math.sin(fineTh) / fineP;
    const cosC = Math.cos(coarseTh) / coarseP;
    const sinC = Math.sin(coarseTh) / coarseP;
    // SYSTEMATISK monitortvätt — det som saknades i första varianten (den bröt
    // inte färg-griden på Gyarados·Deoxys, vilket verkligheten mätt gör):
    // (a) DESATURERING — LCD + kamerans tonkurva tvättar ur färgerna;
    // (b) SVARTNIVÅ-LYFT — monitorns bakgrundsbelysning gör svart till
    //     glödande blågrått, additivt, inte multiplikativt;
    // (c) KONTRASTKROSS. Tillsammans drar de ALLA kort mot samma bleka
    //     färgfamilj — mekanismen bakom "tio blå vattenkort inom 0,05".
    const sat = 0.5 + rnd(10) * 0.3; // 0,5–0,8
    const lift = 18 + rnd(11) * 26; // 18–44 av 255
    const liftTint = [0.85 + rnd(12) * 0.1, 0.95, 1.05 + rnd(13) * 0.15]; // blåaktig
    const contrast = 0.78 + rnd(14) * 0.14; // 0,78–0,92
    // ⛔ AFFINA transformer (gain/lift/kontrast, per kanal) KANCELLERAS av
    // färg-gridens per-kanal-standardisering — de bryter den aldrig. Det som
    // INTE kancelleras är RUMSLIGT varierande ljus, och det är precis vad en
    // monitorfotografering har: LCD:ns off-axis-avfall (ena sidan ljusare),
    // linsvinjettering och blänk. Standardiseringen är global; en rumslig
    // gradient omviktar cellerna olika mycket → layouten förvrängs.
    const gradAmp = 0.15 + rnd(15) * 0.2; // ±15–35 % tvärs över bilden
    const gradTh = rnd(16) * 2 * Math.PI;
    const gcx = Math.cos(gradTh) / width;
    const gcy = Math.sin(gradTh) / height;
    const vign = 0.1 + rnd(17) * 0.15; // hörnavfall 10–25 %
    // Blänk: en mjuk ljusfläck (skärmreflex), additiv och färgsvagt blåvit.
    const glareX = rnd(18) * width;
    const glareY = rnd(19) * height * 0.6; // oftast övre delen (takbelysning)
    const glareR = (0.18 + rnd(20) * 0.22) * Math.max(width, height);
    const glareA = 25 + rnd(21) * 55; // 25–80 av 255

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const m =
          1 +
          fineA * Math.sin(2 * Math.PI * (x * cosF + y * sinF)) +
          coarseA * Math.sin(2 * Math.PI * (x * cosC + y * sinC));
        // Rumsligt ljus: linjär ramp + vinjett + blänk.
        const ramp = 1 + gradAmp * ((x - width / 2) * gcx + (y - height / 2) * gcy) * 2;
        const nx = (x / width - 0.5) * 2;
        const ny = (y / height - 0.5) * 2;
        const vig = 1 - vign * (nx * nx + ny * ny);
        const dgx = x - glareX;
        const dgy = y - glareY;
        const glare = glareA * Math.exp(-(dgx * dgx + dgy * dgy) / (2 * glareR * glareR));
        const p = (y * width + x) * 3;
        const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        for (let c = 0; c < 3; c++) {
          const desat = lum + (d[p + c] - lum) * sat;
          const v =
            desat * contrast * m * gains[c] * ramp * vig +
            lift * liftTint[c] +
            glare * (c === 2 ? 1.05 : 1);
          d[p + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    return await sharp(d, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 72 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * FINGER-OCKLUSION — användaren håller kortet och ett finger täcker en kant.
 * Mätt i produktion 2026-07-31: ett finger över nederkanten fick globala
 * deskriptorer att välja fel kort eller inget alls (fingret korrumperar både
 * sina celler OCH hela vektorns normalisering). Läggs SIST i kedjan (fingret
 * är framför skärmen — skarpt, opåverkat av moiré).
 */
export async function addFingerOcclusion(buf: Buffer, seed: number): Promise<Buffer | null> {
  const rnd = (i: number) => {
    const x = Math.sin(seed * 31337 + i * 271829) * 43758.5453;
    return x - Math.floor(x);
  };
  try {
    const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = raw.info;
    const d = raw.data;
    // Från en KANT (man håller kortet): nederkant vanligast, annars sidorna.
    const edge = rnd(1) < 0.6 ? "bottom" : rnd(2) < 0.5 ? "left" : "right";
    const cx = edge === "bottom" ? rnd(3) * width : edge === "left" ? 0 : width - 1;
    const cy = edge === "bottom" ? height - 1 : (0.4 + rnd(4) * 0.6) * height;
    const rx = (0.12 + rnd(5) * 0.1) * width;
    const ry = (0.1 + rnd(6) * 0.1) * height;
    const skin = [190 + rnd(7) * 40, 130 + rnd(8) * 40, 100 + rnd(9) * 35];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const p = (y * width + x) * 3;
          d[p] = skin[0];
          d[p + 1] = skin[1];
          d[p + 2] = skin[2];
        }
      }
    }
    return await sharp(Buffer.from(d), { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * REGIONALT GRAD-SCORE — ocklusionsrobust aggregering av den BEFINTLIGA
 * grad-vektorn (8×11 celler är rumsliga → dimensionsskivor ÄR regioner, ingen
 * ny lagring behövs). 6 regioner (3 radband × 2 kolumnband); poängen är
 * medlet av de 4 BÄSTA region-cosinusarna — fingrets region kastas som
 * outlier i stället för att förgifta helheten. Samma princip som
 * lokala-särdrags-röstning, i vår billiga arkitektur.
 */
export const GRAD_REGIONS = 6;
const G_REGION_OF = (() => {
  // Per dimension (704) → region 0..5. Cellordning: (cellY*8+cellX)*8+bin.
  const map = new Uint8Array(704);
  for (let cy = 0; cy < 11; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      const rb = cy < 4 ? 0 : cy < 8 ? 1 : 2;
      const cb = cx < 4 ? 0 : 1;
      for (let b = 0; b < 8; b++) map[(cy * 8 + cx) * 8 + b] = rb * 2 + cb;
    }
  }
  return map;
})();

/** Medel av de `keep` bästa region-cosinusarna mellan två grad-vektorer (704 dim). */
export function gradRegionalScore(a: Float32Array, b: Float32Array, keep = 4): number {
  const dots = new Float64Array(GRAD_REGIONS);
  const na = new Float64Array(GRAD_REGIONS);
  const nb = new Float64Array(GRAD_REGIONS);
  for (let i = 0; i < 704; i++) {
    const r = G_REGION_OF[i];
    dots[r] += a[i] * b[i];
    na[r] += a[i] * a[i];
    nb[r] += b[i] * b[i];
  }
  const scores: number[] = [];
  for (let r = 0; r < GRAD_REGIONS; r++) {
    const denom = Math.sqrt(na[r]) * Math.sqrt(nb[r]);
    scores.push(denom > 0 ? dots[r] / denom : 0);
  }
  scores.sort((x, y) => y - x);
  let s = 0;
  for (let i = 0; i < keep; i++) s += scores[i];
  return s / keep;
}
