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
/** ⛔ 0,98 → 1,4 (2026-08-02, fältrunda 10). Grinden var satt för en ENKEL-
 *  skanning där kortet ligger platt i ramen, men i bulk ses korten snett: MÄTT
 *  på ägarens bordsfångst hade korten bbox-form 0,98–1,33, och kvad-rätningen
 *  lyckades då bara på 3 av 8 celler — dvs den vägrade just de kort som behöver
 *  rätningen MEST, varpå avtrycket räknades på en perspektivförvrängd beskärning
 *  (bildpoäng 0,53–0,67 mot 0,74–0,87 i en platt fångst). Vid 1,4: 8 av 8, och
 *  en cell gick från skräp (0,570) till rätt kort (Cynthia's Feebas 0,678);
 *  ingen cell blev sämre. Den platta fångsten är oförändrad (6 av 6 båda).
 *  Övriga vakter (konvexitet, motstående sidor, area, kantstyrka) är orörda, och
 *  den rätade varianten LÄGGS TILL svepet — sökningen tar max per kort, så en
 *  dålig varp kan aldrig sänka rätt korts poäng. */
const ASPECT_MAX = 1.4;
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
/** Maskens långsida. 240 → 480 (2026-08-02, fältrunda 7).
 *  ⛔ Talet är en UPPLÖSNINGSGRÄNS, inte en tuning: två kort som ligger några
 *  millimeter isär skiljs av en springa som vid 240 blir 1–2 maskpixlar, smetas
 *  ihop med kortens ljusa kanter av boxmedelvärdet och läses som FÖRGRUND — de
 *  två korten blir EN region. MÄTT på ägarens 960 px-fångster: 240 och 360
 *  slår ihop paret, 480 och uppåt skiljer det. Under 480 hjälper varken
 *  starkare erosion eller annan tolerans (båda motbevisade, fältrunda 5).
 *  ⛔ Välj INTE ett högre värde på antalet regioner: 560→7, 640→6, 800→7,
 *  960→8 på samma foto. Alla hittar de SEX korten; skillnaden är en ensam
 *  skräpregion som kommer och går, dvs brus. 640 såg bäst ut och vore därför
 *  precis det överanpassade valet. 480 är gränsen där själva problemet löses,
 *  och den billigaste (masken är ~130k pixlar mot 32k — flödesfyllningen är
 *  O(n) och kör på telefonen).
 *  ⛔ En fångst tagen FÖRE BULK_DETECT_MAX=960 bär inte springan alls: där
 *  hjälper ingen maskupplösning, informationen är redan kastad. */
const REGION_MASK_MAX = 480;
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
/** Lokal färgtolerans för bakgrundsöversvämningen, i RGB-avstånd mellan
 *  GRANNPIXLAR i maskskalan (inte mot en global färg). Okänslig: 12, 22 och 30
 *  ger alla 6/6/6 kort på de tre riktiga fångsterna — talet är alltså inte
 *  finjusterat mot dem. För högt ⇒ fyllningen läcker in i korten (hela kortet
 *  försvinner); för lågt ⇒ bordets ådring stoppar fyllningen och bordet blir
 *  förgrund. `diag.backgroundFrac` visar vilket som händer. */
const REGION_FLOOD_TOL = 12;
/** Erosionspass innan komponenterna räknas; bboxen expanderas lika mycket efteråt.
 *  ⛔ MÄTT 2026-08-01 (fältrunda 5): STARKARE erosion löser INTE hopslagna kort.
 *  Två kort med ~4,5 px springa i en 480 px-fångst hamnar på 1–2 MASKpixlar, och
 *  boxmedelvärdet blandar då springan med kortens ljusa kanter — dess mörkaste
 *  värde blev 134,126,103 mot bordets ~40, alltså FÖRGRUND. Bryggan är inte en
 *  tunn brygga att erodera bort utan en utsmetad kant. Både 2 pass och strikt
 *  erosion (alla 4 grannar) provades: oförändrat 5 av 6 kort. Det som saknas är
 *  UPPLÖSNING i masken, inte morfologi. */
const REGION_EROSION_PASSES = 1;
/** Storlekssamstämmighet mot fältets undre median (kort är fysiskt lika stora).
 *  2,5x area ≈ 1,6x i sidled — rymligt för perspektiv över ett bord. */
const REGION_SIZE_MIN_RATIO = 0.4;
const REGION_SIZE_MAX_RATIO = 2.5;
/** Formsamstämmighet mot fotots medianform. Äkta kort mätta över fem riktiga
 *  fångster: 0,83–1,14 av medianen. Skräp: 0,48 (skärmpanel) och 2,13 (tygveck).
 *  Spannet har därmed ~1,3x marginal åt båda håll till närmaste äkta kort. */
const REGION_ASPECT_REL_MIN = 0.65;
const REGION_ASPECT_REL_MAX = 1.55;
/** UNDERLAGET GÅR INTE ATT SKILJA FRÅN KORTEN: största FÖRKASTADE blobben som
 *  andel av bilden. På ett mönstrat underlag stoppas bakgrundsfyllningen av
 *  mönstret, underlaget blir självt förgrund och korten hamnar INUTI den massan
 *  — osynliga. MÄTT: fungerande fångster 3,3–11,2 %, mönstrade underlag
 *  17,4–54,7 %. 14 % ligger med ~25 % marginal åt båda håll.
 *  ⛔ Bara FÖRKASTADE blobbar räknas: ett enda kort fotat nära är också en stor
 *  blob, men den godkänns och ska inte larma. */
const REGION_BUSY_MAX_BLOB = 0.14;
/** Fyllnadsgrad relativt kortklustrets median. MÄTT: äkta kort ligger på
 *  0,92–1,01 av fältets median, skräp (byxveck, skuggor, skärmpaneler) på
 *  högst 0,72. 0,85 ger ~8 % marginal ner till sämsta äkta kort och ~18 % upp
 *  till värsta skräpet. */
const REGION_FILL_REL_MIN = 0.85;

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
  rgb?: Float32Array;
  dist?: Float32Array;
  tol?: number;
  /** Största FÖRKASTADE blobben som andel av bilden. Över
   *  REGION_BUSY_MAX_BLOB betyder det att underlaget smält ihop med korten. */
  largestRejectedFrac?: number;
  /** Underlaget går inte att skilja från korten (se ovan). */
  busySurface?: boolean;
  /** Hur stor del av bilden fyllningen tog. Nära 1,0 = fyllningen har LÄCKT
   *  in i korten; nära 0 = den kom inte loss från kanten. Båda syns direkt. */
  backgroundFrac?: number;
}

export function detectCardRegions(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4,
  maxRegions = 12,
  diag?: RegionDiag,
  tol = REGION_FLOOD_TOL
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

  // BAKGRUND = DET SOM HÄNGER IHOP MED BILDKANTEN (modellbyte 2026-08-01,
  // fältrunda 4). Den gamla modellen skattade en bordsFÄRG ur kantringen och
  // mätte färgavstånd mot den. Den föll så fort ett stort LJUST föremål nådde
  // bildkanten: ägaren la ut sex kort med en t-shirt i nederkanten och fick
  // fyra kort plus ett tygveck som "kort". Fältet dras mot ljust, korten
  // närmast tröjan sjunker under tröskeln, och vecket blir en egen region.
  // MÄTT: INGEN tröskel i hela stegen 30–170 gav alla sex korten — felet satt
  // alltså i modellen, inte i talet.
  //
  // Nu översvämmas bilden inifrån BILDKANTEN med LOKAL färgtolerans: en pixel
  // blir bakgrund om den liknar sin redan-bakgrundsgranne. Påståendet är
  // "bordet är det sammanhängande som når kanten" i stället för "bordet har
  // den här färgen", och det är det rätta påståendet:
  //   · en ljusramp (fönsterljus) är SLÄT → fyllningen går rakt igenom;
  //   · en kortkant är SKARP → fyllningen stannar;
  //   · tröjan NÅR kanten → den blir bakgrund precis som bordet, i stället för
  //     en falsk kortregion.
  // MÄTT på alla tre riktiga fångsterna: 18 av 18 kort, NOLL falska (var
  // 6 + 6 + 4 kort och 1 falsk). Toleransen är okänslig: 12, 22 och 30 ger
  // samma 6/6/6, så talet är inte finjusterat mot fotona.
  //
  // ⛔ FYLLNINGEN ÄR EN KEDJA: läcker den in i ett kort genom en enda mjuk
  // kant försvinner HELA kortet, inte en flisa. Det är ett ANNAT felläge än
  // den gamla modellens gradvisa degradering och det syns bara på riktiga
  // foton — sveps med `TOL=… scripts/bulk-debug.ts`.
  // ⛔ Ett kort som NUDDAR bildkanten fylls som bakgrund och tappas. Det är
  // med flit: ett kort i kanten är ändå beskuret. Overlayen visar det.
  const bg = new Uint8Array(mw * mh);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!bg[i]) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < mw; x++) {
    seed(x);
    seed((mh - 1) * mw + x);
  }
  for (let y = 0; y < mh; y++) {
    seed(y * mw);
    seed(y * mw + mw - 1);
  }
  const tol2 = tol * tol;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % mw;
    const y = (i / mw) | 0;
    const grow = (j: number) => {
      if (bg[j]) return;
      let acc = 0;
      for (let c = 0; c < 3; c++) {
        const d = rgb[j * 3 + c] - rgb[i * 3 + c];
        acc += d * d;
      }
      if (acc <= tol2) seed(j);
    };
    if (x > 0) grow(i - 1);
    if (x < mw - 1) grow(i + 1);
    if (y > 0) grow(i - mw);
    if (y < mh - 1) grow(i + mw);
  }

  // Binärt fält in i den OFÖRÄNDRADE nedströmskedjan: erosion (skuggbryggor),
  // sammanhängande komponenter, formvillkor och storlekssamstämmighet.
  const dist = new Float32Array(mw * mh);
  for (let i = 0; i < dist.length; i++) dist[i] = bg[i] ? 0 : 255;
  if (diag) {
    diag.mw = mw;
    diag.mh = mh;
    diag.rgb = rgb;
    diag.dist = dist;
    diag.tol = tol;
    let n = 0;
    for (let i = 0; i < bg.length; i++) if (bg[i]) n++;
    diag.backgroundFrac = n / bg.length;
  }
  return regionsFromDistance(dist, mw, mh, 128, scale, width, height, maxRegions, diag);
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
  maxRegions: number,
  diag?: RegionDiag
): CardRegion[] {
  const rawMask = new Uint8Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) if (dist[i] > threshold) rawMask[i] = 1;

  // EROSION: skuggbryggor mellan närliggande kort limmar ihop två kort till EN
  // blob. En pixel med färre än 3 av 4 grannar stryks; bboxen expanderas med
  // lika många pixlar efteråt så kortens verkliga kanter inte tappas.
  let mask = rawMask;
  for (let pass = 0; pass < REGION_EROSION_PASSES; pass++) {
    const src = mask;
    const out = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        if (!src[i]) continue;
        let neighbors = 0;
        if (x > 0 && src[i - 1]) neighbors++;
        if (x < mw - 1 && src[i + 1]) neighbors++;
        if (y > 0 && src[i - mw]) neighbors++;
        if (y < mh - 1 && src[i + mw]) neighbors++;
        if (neighbors >= 3) out[i] = 1;
      }
    }
    mask = out;
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
  const bboxAspect = (b: (typeof valid)[number]) =>
    (b.maxX - b.minX + 1) / (b.maxY - b.minY + 1);
  // REFERENSEN ÄR KORTKLUSTRET, INTE MITTEN AV ALLT (fix 2026-08-02).
  // Undre medianen antog att skräpet är STÖRRE än ett kort. MÄTT på ägarens
  // femkortsfångst är det tvärtom: 5 kort (area 4408–5312) och 5 småskräp
  // (391–2178) gav undre median 2178 — ett SKRÄPvärde — och bandet runt det
  // släppte in ett byxveck (1595). Kortens verkliga signatur är att de är den
  // STÖRSTA GRUPPEN av likstora regioner: varje kandidat får rösta på hur många
  // andra som ligger inom samma storleksband, och den vinnande gruppens median
  // blir referens. Här: kortklustret får 5 röster, varje skräpkluster 2–3.
  const areas = valid.map(bboxArea);
  let bestIdx = 0;
  let bestVotes = -1;
  for (let i = 0; i < areas.length; i++) {
    const lo = areas[i] * REGION_SIZE_MIN_RATIO;
    const hi = areas[i] * REGION_SIZE_MAX_RATIO;
    let votes = 0;
    for (let j = 0; j < areas.length; j++) if (areas[j] >= lo && areas[j] <= hi) votes++;
    // Lika många röster → större area vinner: ett kort är aldrig det minsta
    // skräpet i bilden, men skräp kan vara lika talrikt.
    if (votes > bestVotes || (votes === bestVotes && areas[i] > areas[bestIdx])) {
      bestVotes = votes;
      bestIdx = i;
    }
  }
  const clusterLo = areas[bestIdx] * REGION_SIZE_MIN_RATIO;
  const clusterHi = areas[bestIdx] * REGION_SIZE_MAX_RATIO;
  const cluster = valid.filter((b) => {
    const a = bboxArea(b);
    return a >= clusterLo && a <= clusterHi;
  });
  const clusterAreas = cluster.map(bboxArea).sort((a, b) => a - b);
  const refArea = clusterAreas[Math.floor(clusterAreas.length / 2)] ?? 0;

  // FORMSAMSTÄMMIGHET (2026-08-02), samma princip som storleken ovan: korten är
  // fysiskt lika stora OCH lika formade, och i ETT foto ses de från EN vinkel —
  // alltså måste deras bbox-former klustra. Det ABSOLUTA spannet
  // (REGION_ASPECT_*) måste vara vidöppet för perspektiv och vridning, och
  // släpper därför igenom skräp: ägarens fångst gav ett tygveck på knäet (form
  // 2,50) och datorskärmens filträdspanel (0,56) medan de åtta korten låg mellan
  // 0,98 och 1,33. MÄTT över fem riktiga fångster: äkta kort håller sig inom
  // 0,83–1,14 av fotots MEDIANform, skräpet låg på 0,48 och 2,13.
  // Bonus: en hopslagen kortPAR-region (två kort sida vid sida) landar på
  // 1,78–1,93 av medianen och förkastas — samma linje som redan gäller för kort
  // kant-i-kant: hellre färre funna kort än en blandfångst som identifieras
  // självsäkert till fel kort.
  // Formreferensen tas ur SAMMA kluster — annars räknas skräpets former in.
  const sortedAspects = cluster.map(bboxAspect).sort((a, b) => a - b);
  const refAspect = sortedAspects[Math.floor(sortedAspects.length / 2)] ?? 1;

  // FYLLNADSGRAD — den starkaste skiljelinjen mot tyg och skuggor, och den enda
  // med fysisk grund: ett kort är en STYV rektangel och fyller sin bbox, medan
  // ett byxveck, en skuggslinga eller en skärmpanel är oregelbunden. MÄTT över
  // ägarens tre femkortsfångster: korten 0,86–0,98, skräp med meningsfull area
  // 0,37–0,66. Storleks- och formbanden separerade samma skräp med bara ~5 %
  // marginal; det här gör det med ~20 %.
  // ⛔ Absolut tröskel går INTE att använda: ett kort som ligger vridet 15° har
  // fyllnadsgrad 0,65 rent geometriskt (bboxen växer åt båda håll) — samma som
  // skräpet. Därför RELATIVT klustrets median, precis som storlek och form:
  // ligger ALLA kort vridna följer medianen med, och bara det som avviker från
  // fältet faller bort. Det absoluta golvet REGION_FILL_MIN står kvar som
  // grovsåll för enstaka regioner.
  const sortedFills = cluster
    .map((b) => b.area / ((b.maxX - b.minX + 1) * (b.maxY - b.minY + 1)))
    .sort((a, b) => a - b);
  const refFill = sortedFills[Math.floor(sortedFills.length / 2)] ?? 1;
  const accepted = valid
    .filter((b) => {
      const a = bboxArea(b);
      if (a < refArea * REGION_SIZE_MIN_RATIO || a > refArea * REGION_SIZE_MAX_RATIO) return false;
      const r = bboxAspect(b) / (refAspect || 1);
      if (r < REGION_ASPECT_REL_MIN || r > REGION_ASPECT_REL_MAX) return false;
      const fill = b.area / ((b.maxX - b.minX + 1) * (b.maxY - b.minY + 1));
      return fill >= refFill * REGION_FILL_REL_MIN;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, maxRegions);

  if (diag) {
    const keep = new Set(accepted);
    let biggest = 0;
    for (const b of blobs) if (!keep.has(b) && b.area > biggest) biggest = b.area;
    diag.largestRejectedFrac = biggest / (mw * mh);
    diag.busySurface = diag.largestRejectedFrac >= REGION_BUSY_MAX_BLOB;
  }

  return accepted
    .map((b) => ({
      // Kompenserar erosionen så kortets verkliga kant kommer med.
      x: Math.max(0, (b.minX - REGION_EROSION_PASSES) * inv),
      y: Math.max(0, (b.minY - REGION_EROSION_PASSES) * inv),
      w: Math.min(width, (b.maxX - b.minX + 1 + 2 * REGION_EROSION_PASSES) * inv),
      h: Math.min(height, (b.maxY - b.minY + 1 + 2 * REGION_EROSION_PASSES) * inv),
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
