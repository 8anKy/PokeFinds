/**
 * KORT-KVADRATEN — hittar kortets fyra hörn i en fångst och rätar upp det
 * (Fas 1 i skannerplanen, 2026-07-31).
 *
 * VARFÖR: avtrycket är brutalt känsligt för hur kortet ligger i rutan — MÄTT
 * topp-15 mot marginal: 0 % → 96 %, 2 % → 84 %, 6 % → 15 %. Inset/outset-svepet
 * kompenserar (93–97 %) men kostar 6 sökningar och räddar bara SYMMETRISK
 * felinramning: ett kort som ligger snett eller förskjutet i ramen träffas av
 * ingen beskärning i svepet. Att hitta hörnen och perspektiv-räta ger den
 * referenslika beskärningen direkt — samma geometri som katalogbilderna.
 *
 * HELT UTAN BEROENDEN, med flit: OpenCV.js är 8+ MB WASM per besökare
 * (Railway-egress). Det här är ~300 rader ren TS som kör på nedskalade pixlar:
 * Sobel → riktnings-grindad Hough → bästa 4-linjers-kvadrat → validering →
 * homografi + bilinjär varp. Budget ~10–20 ms på en telefon.
 *
 * ⛔ EN implementation för klient (canvas, 4 kanaler) OCH harness (sharp, 3
 * kanaler) — samma regel som art-fingerprint.ts. Harnesset MÄTER exakt den kod
 * klienten shippar; två implementationer hade gått isär tyst.
 *
 * FAILAR ÖPPET ÅT RÄTT HÅLL: hittas ingen kvadrat som klarar valideringen
 * returneras null och fångsten fortsätter exakt som förut (svepet). En felaktig
 * varp vore värre än ingen — därför är valideringen strikt (konvexitet,
 * sidoförhållande, area, kantstyrka) och tröskeln hellre för hård än för mjuk.
 */

export interface CardQuad {
  /** Hörn i KÄLLPIXLAR, ordnade TL, TR, BR, BL. */
  corners: [number, number][];
  /** Grov kvalitetssignal 0..1 (normerad Hough-röststyrka), bara för diagnostik. */
  score: number;
}

/** Analysbredd — Hough körs på en nedskalad gråskalebild för hastighet. */
const ANALYSIS_MAX = 200;
/** Vinkelupplösning (grader) och fönster: kortkanter är nära lod/våg i vyn. */
const THETA_STEP = 1.5;
const THETA_WINDOW = 32; // ± grader runt lod respektive våg
/** Gradientriktningen måste hålla med linjens normal — silar bort konstens kanter. */
const GRAD_ALIGN_DEG = 24;
const RHO_STEP = 2;
/** Kortets sidoförhållande är 63/88 ≈ 0,716; perspektiv ger slack åt båda håll. */
const ASPECT_MIN = 0.52;
const ASPECT_MAX = 0.98;
/** Kvadraten måste täcka en meningsfull del av analysytan. */
const MIN_AREA_FRACTION = 0.12;
/** Motstående sidor får inte skilja mer än så här (perspektivslack). */
const OPPOSITE_SIDE_RATIO = 1.6;

/** Boxmedelvärdad luminans — samma portabla aritmetik som art-fingerprint.ts. */
function toGray(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4,
  gw: number,
  gh: number
): Float32Array {
  const sums = new Float64Array(gw * gh);
  const counts = new Uint32Array(gw * gh);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, Math.floor((y * gh) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / width));
      const p = (y * width + x) * channels;
      sums[gy * gw + gx] +=
        0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
      counts[gy * gw + gx]++;
    }
  }
  const out = new Float32Array(gw * gh);
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? sums[i] / counts[i] : 0;
  return out;
}

interface HoughPeak {
  rho: number;
  thetaRad: number;
  votes: number;
}

/**
 * Hough-transform grindad på gradientriktning: en kantpixel röstar bara på
 * linjer vars normal pekar åt samma håll som pixelns gradient. Det gör
 * ackumulatorn dramatiskt renare — konstens inre kanter pekar åt alla håll och
 * släcker varandra, medan kortets fyra långa raka kanter röstar koherent.
 */
function houghLines(
  gray: Float32Array,
  w: number,
  h: number
): {
  vertical: HoughPeak[];
  horizontal: HoughPeak[];
  edges: { xs: Float32Array; ys: Float32Array; mags: Float32Array; angs: Float32Array };
} {
  // Sobel-gradienter (interiören räcker).
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  let magSum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] -
        gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
      const gy =
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] -
        gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      magSum += m;
      // Gradientens riktning = linjens normal (mod π).
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      ang[i] = a;
    }
  }
  // Tröskel: kanter tydligt över medelgradienten. Percentilfri (ingen sortering
  // av 40k värden per poll) men adaptiv mot bildens kontrastnivå.
  const threshold = (magSum / (w * h)) * 2.5;

  // Kantpixellista — används både av Hough nedan och av linjeförfiningen
  // (refineLine): sub-bin-precision kräver de råa pixlarna, inte ackumulatorn.
  const exs: number[] = [];
  const eys: number[] = [];
  const ems: number[] = [];
  const eas: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mag[i] < threshold) continue;
      exs.push(x);
      eys.push(y);
      ems.push(mag[i]);
      eas.push(ang[i]);
    }
  }
  const edges = {
    xs: Float32Array.from(exs),
    ys: Float32Array.from(eys),
    mags: Float32Array.from(ems),
    angs: Float32Array.from(eas),
  };

  const diag = Math.ceil(Math.sqrt(w * w + h * h));
  const rhoBins = Math.ceil((2 * diag) / RHO_STEP);
  const windows = [
    { center: 0, out: [] as HoughPeak[] }, // normal ≈ vågrät → LODRÄT kant
    { center: Math.PI / 2, out: [] as HoughPeak[] }, // normal ≈ lodrät → VÅGRÄT kant
  ];
  const thetaCount = Math.floor((2 * THETA_WINDOW) / THETA_STEP) + 1;
  const alignRad = (GRAD_ALIGN_DEG * Math.PI) / 180;

  for (const win of windows) {
    const acc = new Float32Array(thetaCount * rhoBins);
    const thetas = new Float64Array(thetaCount);
    const cosT = new Float64Array(thetaCount);
    const sinT = new Float64Array(thetaCount);
    for (let t = 0; t < thetaCount; t++) {
      const deg = -THETA_WINDOW + t * THETA_STEP;
      const rad = win.center + (deg * Math.PI) / 180;
      thetas[t] = rad;
      cosT[t] = Math.cos(rad);
      sinT[t] = Math.sin(rad);
    }
    for (let e = 0; e < edges.xs.length; e++) {
      const x = edges.xs[e];
      const y = edges.ys[e];
      const m = edges.mags[e];
      const a = edges.angs[e];
      for (let t = 0; t < thetaCount; t++) {
        // Riktningsgrind (mod π, med wrap).
        let d = Math.abs(a - (((thetas[t] % Math.PI) + Math.PI) % Math.PI));
        if (d > Math.PI / 2) d = Math.PI - d;
        if (d > alignRad) continue;
        const rho = x * cosT[t] + y * sinT[t];
        const bin = Math.round((rho + diag) / RHO_STEP);
        if (bin >= 0 && bin < rhoBins) acc[t * rhoBins + bin] += m;
      }
    }
    // Toppar med icke-max-undertryckning i rho. Fönstret är MEDVETET litet
    // (~2,5 % av kortsidan): kortets ytterkant och den inre ramens kant ligger
    // ofta bara några pixlar isär, och ett stort fönster smälter ihop dem till
    // EN topp viktad mot den starkare (ofta den inre) — dvs en tyst
    // felbeskärning. Små fönster låter båda bli toppar; pickPair väljer sedan
    // det yttersta paret.
    const suppress = Math.max(2, Math.round((Math.min(w, h) * 0.025) / RHO_STEP));
    const peaks: HoughPeak[] = [];
    const taken: number[] = [];
    for (let n = 0; n < 8; n++) {
      let best = -1;
      let bestV = 0;
      for (let j = 0; j < acc.length; j++) {
        if (acc[j] <= bestV) continue;
        const bin = j % rhoBins;
        if (taken.some((tb) => Math.abs(tb - bin) < suppress)) continue;
        best = j;
        bestV = acc[j];
      }
      if (best < 0 || bestV <= 0) break;
      const t = Math.floor(best / rhoBins);
      const bin = best % rhoBins;
      taken.push(bin);
      peaks.push({ rho: bin * RHO_STEP - diag, thetaRad: thetas[t], votes: bestV });
    }
    win.out.push(...peaks);
  }
  return { vertical: windows[0].out, horizontal: windows[1].out, edges };
}

/**
 * SUB-BIN-FÖRFINING: Hough-ackumulatorns upplösning (ρ-steg 2 px på en ~200 px
 * analys + θ-steg 1,5°) ger hörnfel på flera procent av kortbredden — och
 * avtryckets topp-15 tappar mätbart redan vid 2 % beskärningsfel. Varje vald
 * linje passas därför om mot de RÅA kantpixlarna nära den (total least squares,
 * magnitudviktad, riktningsgrindad): kvantiseringsfelet försvinner och varpen
 * landar på kortets faktiska kant.
 */
function refineLine(
  peak: HoughPeak,
  edges: { xs: Float32Array; ys: Float32Array; mags: Float32Array; angs: Float32Array },
  band: number
): HoughPeak {
  const cos = Math.cos(peak.thetaRad);
  const sin = Math.sin(peak.thetaRad);
  const alignRad = (GRAD_ALIGN_DEG * Math.PI) / 180;
  const normal = ((peak.thetaRad % Math.PI) + Math.PI) % Math.PI;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let e = 0; e < edges.xs.length; e++) {
    const x = edges.xs[e];
    const y = edges.ys[e];
    if (Math.abs(x * cos + y * sin - peak.rho) > band) continue;
    let d = Math.abs(edges.angs[e] - normal);
    if (d > Math.PI / 2) d = Math.PI - d;
    if (d > alignRad) continue;
    const wgt = edges.mags[e];
    sw += wgt;
    sx += wgt * x;
    sy += wgt * y;
    sxx += wgt * x * x;
    sxy += wgt * x * y;
    syy += wgt * y * y;
  }
  if (sw <= 0) return peak;
  const mx = sx / sw;
  const my = sy / sw;
  const cxx = sxx / sw - mx * mx;
  const cxy = sxy / sw - mx * my;
  const cyy = syy / sw - my * my;
  // Minsta egenvektorn till kovariansen = linjens NORMAL (total least squares).
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const lambda = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let nx = cxy;
  let ny = lambda - cxx;
  const nn = Math.hypot(nx, ny);
  if (nn < 1e-9) return peak;
  nx /= nn;
  ny /= nn;
  // Håll normalen på samma sida som originalet (ρ ska förbli jämförbar).
  if (nx * cos + ny * sin < 0) {
    nx = -nx;
    ny = -ny;
  }
  const theta = Math.atan2(ny, nx);
  // Förfiningen får justera, inte byta linje: mer än ~4° eller ett band ifrån →
  // passningen drog i väg mot en annan struktur, behåll originalet.
  let dTheta = Math.abs(theta - peak.thetaRad);
  if (dTheta > Math.PI) dTheta = 2 * Math.PI - dTheta;
  const rho = mx * nx + my * ny;
  if (dTheta > (4 * Math.PI) / 180 || Math.abs(rho - peak.rho) > band) return peak;
  return { rho, thetaRad: theta, votes: peak.votes };
}

/** Skärningspunkt mellan två Hough-linjer (x·cosθ + y·sinθ = ρ). */
function intersect(a: HoughPeak, b: HoughPeak): [number, number] | null {
  const ca = Math.cos(a.thetaRad);
  const sa = Math.sin(a.thetaRad);
  const cb = Math.cos(b.thetaRad);
  const sb = Math.sin(b.thetaRad);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-9) return null;
  return [(a.rho * sb - b.rho * sa) / det, (ca * b.rho - cb * a.rho) / det];
}

function dist(p: [number, number], q: [number, number]): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/** Tecknad area ×2 (shoelace). Positiv för medurs i skärmkoordinater. */
function polyArea(c: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const j = (i + 1) % c.length;
    s += c[i][0] * c[j][1] - c[j][0] * c[i][1];
  }
  return s / 2;
}

/**
 * Hitta kortets kvadrat. `pixels` är RGB(A) i valfri storlek — analysen sker på
 * en intern nedskalning, hörnen returneras i KÄLLANS koordinater.
 */
export function detectCardQuad(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4
): CardQuad | null {
  if (width < 32 || height < 32) return null;
  if (pixels.length < width * height * channels) return null;
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(width, height));
  const aw = Math.max(32, Math.round(width * scale));
  const ah = Math.max(32, Math.round(height * scale));
  const gray = toGray(pixels, width, height, channels, aw, ah);

  const { vertical, horizontal, edges } = houghLines(gray, aw, ah);
  if (vertical.length < 2 || horizontal.length < 2) return null;

  // Välj linjepar per riktning med tillräcklig separation: kortets vänster/höger
  // kant skiljer ≥ 35 % av bredden, topp/botten ≥ 35 % av höjden. Bland par som
  // är nästan lika starka väljs det YTTERSTA: ett kort har ofta en inre ram vars
  // kant är minst lika kontrastrik som ytterkanten, och avtrycket ska räknas på
  // HELA kortet — den inre ramen vore en tyst felbeskärning.
  const pickPair = (peaks: HoughPeak[], minSep: number): [HoughPeak, HoughPeak] | null => {
    let bestVotes = 0;
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        if (Math.abs(peaks[i].rho - peaks[j].rho) < minSep) continue;
        bestVotes = Math.max(bestVotes, peaks[i].votes + peaks[j].votes);
      }
    }
    if (bestVotes === 0) return null;
    let best: [HoughPeak, HoughPeak] | null = null;
    let bestSep = 0;
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        const sep = Math.abs(peaks[i].rho - peaks[j].rho);
        if (sep < minSep) continue;
        // Golvet är lågt (35 %) med flit: ytterkantens kontrast (kort mot
        // skrivbord) är ofta svagare än den inre ramens, och det YTTERSTA
        // paret är det rätta även när det inte är det starkaste. Valideringen
        // (konvexitet, sidoförhållande, area) fångar nonsens-par.
        if (peaks[i].votes + peaks[j].votes < bestVotes * 0.35) continue;
        if (sep > bestSep) {
          bestSep = sep;
          best = [peaks[i], peaks[j]];
        }
      }
    }
    return best;
  };
  const vPair = pickPair(vertical, aw * 0.35);
  const hPair = pickPair(horizontal, ah * 0.35);
  if (!vPair || !hPair) return null;

  // Sub-bin-förfining mot de råa kantpixlarna (band = 2 ρ-steg).
  const band = RHO_STEP * 2;
  const vs = vPair.map((p) => refineLine(p, edges, band));
  const hs = hPair.map((p) => refineLine(p, edges, band));
  const [vA, vB] = vs[0].rho <= vs[1].rho ? [vs[0], vs[1]] : [vs[1], vs[0]];
  const [hA, hB] = hs[0].rho <= hs[1].rho ? [hs[0], hs[1]] : [hs[1], hs[0]];
  // TL, TR, BR, BL — vänster/topp är lägre rho i respektive fönster.
  const tl = intersect(vA, hA);
  const tr = intersect(vB, hA);
  const br = intersect(vB, hB);
  const bl = intersect(vA, hB);
  if (!tl || !tr || !br || !bl) return null;
  const corners: [number, number][] = [tl, tr, br, bl];

  // VALIDERING — hellre null än en fel varp.
  // (1) Hörnen inom analysytan med lite slack (kanten kan ligga precis utanför).
  const slackX = aw * 0.06;
  const slackY = ah * 0.06;
  for (const [x, y] of corners) {
    if (x < -slackX || x > aw + slackX || y < -slackY || y > ah + slackY) return null;
  }
  // (2) Konvex och icke-degenererad.
  const area = Math.abs(polyArea(corners));
  if (area < aw * ah * MIN_AREA_FRACTION) return null;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    const r = corners[(i + 2) % 4];
    const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
    if (cross <= 0) return null; // TL→TR→BR→BL ska vara medurs (skärm-y nedåt)
  }
  // (3) Motstående sidor rimligt lika (perspektiv, inte trapets-nonsens).
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) > OPPOSITE_SIDE_RATIO) return null;
  if (Math.max(left, right) / Math.max(1, Math.min(left, right)) > OPPOSITE_SIDE_RATIO) return null;
  // (4) Sidoförhållandet ska likna ett kort (63×88).
  const aspect = (top + bottom) / Math.max(1, left + right);
  if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) return null;

  // Röststyrka relativt den totala kantmassan — grov men jämförbar signal.
  const totalVotes = vA.votes + vB.votes + hA.votes + hB.votes;
  const score = Math.min(1, totalVotes / (aw * ah * 40));

  const inv = 1 / scale;
  return {
    corners: corners.map(([x, y]) => [x * inv, y * inv] as [number, number]),
    score,
  };
}

/** Varpmålets storlek: kortets 63:88 i tillräcklig upplösning för avtrycken
 *  (grad-griden kräver 96×132; DCT 64×64). 240×335 ≈ 0,716. */
export const RECTIFIED_W = 240;
export const RECTIFIED_H = 335;

/**
 * Perspektiv-varp: kvadraten → en rät RECTIFIED_W×RECTIFIED_H-bild (RGBA).
 * Homografin är Heckberts slutna form för enhetskvadrat → fyrhörning; samplingen
 * är bilinjär. Ren aritmetik — identisk i canvas-JS och Node.
 */
export function warpPerspective(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4,
  corners: [number, number][],
  outW = RECTIFIED_W,
  outH = RECTIFIED_H
): Uint8ClampedArray | null {
  if (corners.length !== 4) return null;
  const [p0, p1, p2, p3] = corners; // TL, TR, BR, BL
  const sx = p0[0] - p1[0] + p2[0] - p3[0];
  const sy = p0[1] - p1[1] + p2[1] - p3[1];
  const d1x = p1[0] - p2[0];
  const d1y = p1[1] - p2[1];
  const d2x = p3[0] - p2[0];
  const d2y = p3[1] - p2[1];
  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-9) return null;
  const g = (sx * d2y - sy * d2x) / det;
  const hh = (d1x * sy - d1y * sx) / det;
  const a = p1[0] - p0[0] + g * p1[0];
  const b = p3[0] - p0[0] + hh * p3[0];
  const c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1];
  const e = p3[1] - p0[1] + hh * p3[1];
  const f = p0[1];

  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let oy = 0; oy < outH; oy++) {
    const v = (oy + 0.5) / outH;
    for (let ox = 0; ox < outW; ox++) {
      const u = (ox + 0.5) / outW;
      const w = g * u + hh * v + 1;
      const x = (a * u + b * v + c) / w;
      const y = (d * u + e * v + f) / w;
      const o = (oy * outW + ox) * 4;
      // Utanför källan → svart (valideringen gör detta sällsynt).
      if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
        out[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * width + x0) * channels;
      const i10 = (y0 * width + x1) * channels;
      const i01 = (y1 * width + x0) * channels;
      const i11 = (y1 * width + x1) * channels;
      for (let ch = 0; ch < 3; ch++) {
        const top = pixels[i00 + ch] * (1 - fx) + pixels[i10 + ch] * fx;
        const bot = pixels[i01 + ch] * (1 - fx) + pixels[i11 + ch] * fx;
        out[o + ch] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
