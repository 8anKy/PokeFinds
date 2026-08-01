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

/**
 * FRILAGD FLERKORTSDETEKTERING (bulk v2, 2026-08-01): hitta VARJE korts region
 * i en bordsbild — ingen rutnätsguide, korten får ligga hur som helst (med
 * lite mellanrum).
 *
 * Metod: bakgrundssegmentering + sammanhängande komponenter. Bordet är i regel
 * en någorlunda enhetlig yta; bakgrundsfärgen skattas ur bildens KANTRING
 * (median), och pixlar långt från den är förgrund. Blobbar med rimlig area och
 * form blir kortregioner. Precisionen behövs inte här — varje region körs
 * sedan genom detectCardQuad + varp för exakta hörn, precis som en rutnätscell.
 *
 * ⛔ KORT SOM RÖR VID VARANDRA smälter ihop till EN blob och blir EN region —
 * det är den kända begränsningen, och UI-hinten ("lite mellanrum") är
 * motmedlet. En pärmsida (nio kort kant i kant) blir därför EN jätteblob;
 * formvalideringen förkastar den hellre än gissar.
 */
const REGION_MASK_MAX = 240;
/**
 * Blob-arean måste vara 0,15–30 % av bilden. Golvet var 0,4 % och det åt upp
 * fotograferingar FRÅN HÅLL (mätt av ägaren 2026-08-01: sex kort på bordet →
 * bara 1–2 hittades, resten var för små för golvet). 0,15 % ≈ ett kort som är
 * ~1/26 av bildbredden — mindre än så bär ändå inte nog pixlar för avtrycket.
 */
const REGION_MIN_AREA_FRAC = 0.0015;
const REGION_MAX_AREA_FRAC = 0.3;
/** Bbox-form: ett roterat kort ger bredare bbox än 63:88 — generöst spann. */
const REGION_ASPECT_MIN = 0.33;
const REGION_ASPECT_MAX = 3.0;
/** Blobben ska FYLLA sin bbox någorlunda — glesa spretiga blobbar är skuggor. */
const REGION_FILL_MIN = 0.35;
/** Storlekssamstämmighet mot fältets undre median (kort är fysiskt lika stora).
 *  2,5x area ≈ 1,6x i sidled — rymligt för perspektiv över ett bord. */
const REGION_SIZE_MIN_RATIO = 0.4;
const REGION_SIZE_MAX_RATIO = 2.5;

export interface CardRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Utdata-fack för fältfelsökningen (scripts/bulk-debug.ts): avståndsfältet och
 *  de tal tröskeln byggs av, så ett svep kan köras mot VERKLIGA foton utan att
 *  detektorlogiken kopieras. Fylls bara när facket skickas med. */
export interface RegionDiag {
  mw?: number;
  mh?: number;
  dist?: Float32Array;
  threshold?: number;
  noiseFloor?: number;
  otsu?: number;
}

export function detectCardRegions(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4,
  maxRegions = 12,
  diag?: RegionDiag
): CardRegion[] {
  if (width < 64 || height < 64) return [];
  if (pixels.length < width * height * channels) return [];
  const scale = Math.min(1, REGION_MASK_MAX / Math.max(width, height));
  const mw = Math.max(32, Math.round(width * scale));
  const mh = Math.max(32, Math.round(height * scale));

  // Nedskalad RGB via boxmedelvärde (samma portabla aritmetik som avtrycket).
  const sums = new Float64Array(mw * mh * 3);
  const counts = new Uint32Array(mw * mh);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(mh - 1, Math.floor((y * mh) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(mw - 1, Math.floor((x * mw) / width));
      const p = (y * width + x) * channels;
      const cell = gy * mw + gx;
      sums[cell * 3] += pixels[p];
      sums[cell * 3 + 1] += pixels[p + 1];
      sums[cell * 3 + 2] += pixels[p + 2];
      counts[cell]++;
    }
  }
  const rgb = new Float32Array(mw * mh * 3);
  for (let i = 0; i < mw * mh; i++) {
    const n = counts[i] || 1;
    rgb[i * 3] = sums[i * 3] / n;
    rgb[i * 3 + 1] = sums[i * 3 + 1] / n;
    rgb[i * 3 + 2] = sums[i * 3 + 2] / n;
  }

  // Bakgrund = median-RGB av kantringen (bordet når bildens kanter; korten
  // ligger i mitten). Median, inte medel — ett kort som nuddar kanten ska inte
  // dra iväg skattningen.
  const border: number[][] = [[], [], []];
  const pushPx = (i: number) => {
    border[0].push(rgb[i * 3]);
    border[1].push(rgb[i * 3 + 1]);
    border[2].push(rgb[i * 3 + 2]);
  };
  for (let x = 0; x < mw; x++) {
    pushPx(x);
    pushPx((mh - 1) * mw + x);
  }
  for (let y = 1; y < mh - 1; y++) {
    pushPx(y * mw);
    pushPx(y * mw + mw - 1);
  }
  const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const bg = [median(border[0]), median(border[1]), median(border[2])];

  // TRÖSKELN LÄRS UR BILDEN (fix 2026-08-01): den gamla regeln (kantringens
  // brusgolv × 2,5, golv 1400 ≈ 37 i RGB-avstånd) missade LÅGKONTRAST-kort och
  // hela fotograferingar från håll — ägaren la ut sex kort och fick 1–2.
  // Otsu-split på AVSTÅNDSFÖRDELNINGEN separerar bakgrundsklustret från
  // förgrunden var gränsen än ligger i just den här bilden; kantringens
  // spridning behålls bara som GOLV så en tom bordsyta inte klyvs i brus.
  //
  // LOKAL BAKGRUND (fix 2026-08-01, andra fältrundan): EN global bordfärg
  // faller på ojämnt ljus — fönsterljus gör ena sidan av bordet mycket
  // ljusare, och kort i den mörka delen hamnar nära den GLOBALA medianen.
  //
  // ⛔ Bakgrundsfältet byggs ENBART ur KANTRINGEN, aldrig ur inre pixlar. Ett
  // första försök lät "grovt bakgrundslika" inre pixlar rösta per tile — och
  // när korten dominerar en yta (eller hela bilden) inverterar rösten:
  // detektorn börjar tro att KORTET är bordet och flaggar bordskanten som
  // förgrund. Ringen är det enda vi VET är bakgrund; ojämnt ljus fångas ändå,
  // för ringen bär själv rampen (mörk kant på ena sidan, ljus på den andra).
  // Varje pixels bakgrund = avståndsviktad blandning av närmaste
  // ringsegmentens medianer (topp/botten per kolumnband, vänster/höger per
  // radband) — ett mjukt "bordsfärgfält" över bilden.
  const SEG = 5;
  const segMedian = (
    pick: (t: number) => { r: number; g: number; b: number }[]
  ): number[][] =>
    Array.from({ length: SEG }, (_, t) => {
      const px = pick(t);
      const rs = px.map((p) => p.r);
      const gs = px.map((p) => p.g);
      const bs = px.map((p) => p.b);
      return px.length > 0 ? [median(rs), median(gs), median(bs)] : bg;
    });
  const ringPx = (i: number) => ({ r: rgb[i * 3], g: rgb[i * 3 + 1], b: rgb[i * 3 + 2] });
  const topSeg = segMedian((t) => {
    const out = [];
    for (let x = Math.floor((t * mw) / SEG); x < Math.floor(((t + 1) * mw) / SEG); x++) {
      out.push(ringPx(x));
    }
    return out;
  });
  const bottomSeg = segMedian((t) => {
    const out = [];
    for (let x = Math.floor((t * mw) / SEG); x < Math.floor(((t + 1) * mw) / SEG); x++) {
      out.push(ringPx((mh - 1) * mw + x));
    }
    return out;
  });
  const leftSeg = segMedian((t) => {
    const out = [];
    for (let y = Math.floor((t * mh) / SEG); y < Math.floor(((t + 1) * mh) / SEG); y++) {
      out.push(ringPx(y * mw));
    }
    return out;
  });
  const rightSeg = segMedian((t) => {
    const out = [];
    for (let y = Math.floor((t * mh) / SEG); y < Math.floor(((t + 1) * mh) / SEG); y++) {
      out.push(ringPx(y * mw + mw - 1));
    }
    return out;
  });

  const dist = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const ySeg = Math.min(SEG - 1, Math.floor((y * SEG) / mh));
    // Avståndsvikt mot respektive kant (+1 mot division med noll).
    const wT = 1 / (y + 1);
    const wB = 1 / (mh - y);
    for (let x = 0; x < mw; x++) {
      const xSeg = Math.min(SEG - 1, Math.floor((x * SEG) / mw));
      const wL = 1 / (x + 1);
      const wR = 1 / (mw - x);
      const wSum = wT + wB + wL + wR;
      const t = topSeg[xSeg];
      const b2 = bottomSeg[xSeg];
      const l = leftSeg[ySeg];
      const r2 = rightSeg[ySeg];
      const i = y * mw + x;
      let acc = 0;
      for (let c = 0; c < 3; c++) {
        const bgC = (t[c] * wT + b2[c] * wB + l[c] * wL + r2[c] * wR) / wSum;
        const d = rgb[i * 3 + c] - bgC;
        acc += d * d;
      }
      dist[i] = Math.sqrt(acc);
    }
  }
  // BRUSGOLVET MÄTS I SAMMA FÄLT SOM ALLT ANNAT (fix 2026-08-01, tredje
  // fältrundan): golvet räknades mot den GLOBALA medianen medan varje pixel
  // mäts mot det LOKALA fältet. En ring som innehåller tangentbord och vit
  // tröja läste därför 209 som "brus" → tröskel 293, och ägarens sex utlagda
  // kort gav NOLL träffar (den andra fångsten samma minut: 5 av 6).
  // ⛔ Och statistiken måste vara ROBUST: p95 av ringen ÄR skräpet när skräpet
  // ligger i ringen (ringens p50 var 9 och p95 90 i samma bild). Median +
  // 3 robusta σ (MAD) rör sig knappt av inträngande förgrund (126,6 → 51,1
  // resp. 134,5 → 46,2) men mäter fortfarande en tom bordsytas ådring, vilket
  // är golvets hela syfte.
  const ringDist: number[] = [];
  for (let x = 0; x < mw; x++) ringDist.push(dist[x], dist[(mh - 1) * mw + x]);
  for (let y = 1; y < mh - 1; y++) ringDist.push(dist[y * mw], dist[y * mw + mw - 1]);
  ringDist.sort((a, b) => a - b);
  const ringMedian = ringDist[Math.floor(ringDist.length / 2)];
  const ringDev = ringDist.map((v) => Math.abs(v - ringMedian)).sort((a, b) => a - b);
  const noiseFloor = ringMedian + 3 * 1.4826 * ringDev[Math.floor(ringDev.length / 2)];

  // Otsu över 128 fack, begränsat till spannet [lo, hi].
  const BINS = 128;
  const otsuSplit = (lo: number, hi: number): number => {
    const binW = Math.max(1e-6, (hi - lo) / BINS);
    const hist = new Float64Array(BINS);
    let n = 0;
    for (let i = 0; i < dist.length; i++) {
      const v = dist[i];
      if (v < lo || v > hi) continue;
      hist[Math.min(BINS - 1, Math.floor((v - lo) / binW))]++;
      n++;
    }
    if (n === 0) return hi;
    let totalSum = 0;
    for (let b = 0; b < BINS; b++) totalSum += b * hist[b];
    let wB = 0;
    let sumB = 0;
    let bestVar = 0;
    let otsuBin = BINS - 1;
    for (let b = 0; b < BINS; b++) {
      wB += hist[b];
      if (wB === 0) continue;
      const wF = n - wB;
      if (wF === 0) break;
      sumB += b * hist[b];
      const mB = sumB / wB;
      const mF = (totalSum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) {
        bestVar = between;
        otsuBin = b;
      }
    }
    return lo + (otsuBin + 1) * binW;
  };
  let maxD = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > maxD) maxD = dist[i];

  // TVÅ NIVÅER (fix 2026-08-01, tredje fältrundan): ett bordsfoto innehåller
  // nästan alltid en TREDJE klass — rummet, fotografens kropp, tangentbordet —
  // som är BÅDE större och mycket längre från bordsfärgen än korten. Ett enda
  // snitt lägger sig då mellan BORDET och den klassen och lämnar korten på
  // bakgrundssidan. MÄTT på ägarens två fångster: snittet hamnade på 103–104
  // medan bandet där alla sex korten hittas är 40–80. Andra snittet körs på
  // fördelningen UNDER det första och delar det som återstår: bord vs kort
  // (43,2 resp. 45,0 — mitt i bandet).
  const otsuTwoLevel = otsuSplit(0, otsuSplit(0, maxD));
  const threshold = Math.max(otsuTwoLevel, noiseFloor, 20);
  if (diag) {
    diag.mw = mw;
    diag.mh = mh;
    diag.dist = dist;
    diag.threshold = threshold;
    diag.noiseFloor = noiseFloor;
    diag.otsu = otsuTwoLevel;
  }
  return regionsFromDistance(dist, mw, mh, threshold, scale, width, height, maxRegions);
}

/** Avståndsfältet → validerade regioner: tröskling, erosion, sammanhängande
 *  komponenter, formvalidering. BRUTEN UR detectCardRegions med flit — verktyg
 *  som sveper tröskeln (scripts/bulk-debug.ts) måste köra EXAKT samma kod som
 *  produktionen, annars mäter svepet något annat än det som shippar. */
export function regionsFromDistance(
  dist: Float32Array,
  mw: number,
  mh: number,
  threshold: number,
  scale: number,
  width: number,
  height: number,
  maxRegions: number
): CardRegion[] {
  const rawMask = new Uint8Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) if (dist[i] > threshold) rawMask[i] = 1;

  // EROSION (1 pass): skuggbryggor mellan närliggande kort är 1–2 pixlar
  // tunna i maskskalan och limmade förr ihop två kort till EN förkastad blob.
  // En pixel med färre än 3 av 4 grannar i masken stryks; bboxen expanderas
  // med en pixel efteråt så kortets verkliga kant inte tappas.
  const mask = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x;
      if (!rawMask[i]) continue;
      let neighbors = 0;
      if (x > 0 && rawMask[i - 1]) neighbors++;
      if (x < mw - 1 && rawMask[i + 1]) neighbors++;
      if (y > 0 && rawMask[i - mw]) neighbors++;
      if (y < mh - 1 && rawMask[i + mw]) neighbors++;
      if (neighbors >= 3) mask[i] = 1;
    }
  }

  // Sammanhängande komponenter (4-grannskap, iterativ stack — ingen rekursion).
  const label = new Int32Array(mw * mh).fill(-1);
  const blobs: Array<{ minX: number; maxX: number; minY: number; maxY: number; area: number }> =
    [];
  const stack: number[] = [];
  for (let start = 0; start < mw * mh; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = blobs.length;
    const blob = { minX: mw, maxX: 0, minY: mh, maxY: 0, area: 0 };
    stack.length = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % mw;
      const y = (i / mw) | 0;
      blob.area++;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
      const tryPush = (j: number) => {
        if (mask[j] && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      };
      if (x > 0) tryPush(i - 1);
      if (x < mw - 1) tryPush(i + 1);
      if (y > 0) tryPush(i - mw);
      if (y < mh - 1) tryPush(i + mw);
    }
    blobs.push(blob);
  }

  const total = mw * mh;
  const inv = 1 / scale;
  const valid = blobs.filter((b) => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const aspect = bw / bh;
    return (
      b.area >= total * REGION_MIN_AREA_FRAC &&
      b.area <= total * REGION_MAX_AREA_FRAC &&
      aspect >= REGION_ASPECT_MIN &&
      aspect <= REGION_ASPECT_MAX &&
      b.area / (bw * bh) >= REGION_FILL_MIN
    );
  });

  // STORLEKSSAMSTÄMMIGHET (fix 2026-08-01): formvillkoren ovan är med flit
  // generösa (ett snedlagt kort ger bred bbox), och de släpper därför igenom
  // fotografens kropp (28 % av bilden, bbox-form 1,55) och tangentbordsflisor.
  // Men ALLA Pokémon-kort är FYSISKT lika stora: i ETT foto måste deras areor
  // ligga nära varandra. Referensen är den UNDRE medianen — skräpet är nästan
  // alltid STÖRRE än ett kort, och undre medianen håller sig då i kortklassen
  // även när skräpet är i minoritet. MÄTT: tog ägarens två fångster från
  // 9 resp. 10 regioner till exakt 6 kort, noll falska.
  // ⛔ Detta är ett förhållande, inte ett tak — hårdkoda ALDRIG en maxarea i
  // stället: två kort fotade nära fyller mer av bilden än sex på håll.
  const bboxArea = (b: (typeof valid)[number]) =>
    (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
  const sortedAreas = valid.map(bboxArea).sort((a, b) => a - b);
  const refArea = sortedAreas[Math.floor((sortedAreas.length - 1) / 2)] ?? 0;
  return valid
    .filter((b) => {
      const a = bboxArea(b);
      return a >= refArea * REGION_SIZE_MIN_RATIO && a <= refArea * REGION_SIZE_MAX_RATIO;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, maxRegions)
    .map((b) => ({
      // ±1 maskpixel: kompenserar erosionen så kortets verkliga kant kommer med.
      x: Math.max(0, (b.minX - 1) * inv),
      y: Math.max(0, (b.minY - 1) * inv),
      w: Math.min(width, (b.maxX - b.minX + 3) * inv),
      h: Math.min(height, (b.maxY - b.minY + 3) * inv),
    }));
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
