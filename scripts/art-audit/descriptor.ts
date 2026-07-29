/**
 * SPIKE — bildmatchning UTAN neuralt nätverk.
 *
 * Frågan spiken ska svara på: kan en billig bild-"fingeravtryck" skilja 20 563
 * visuellt LIKA kort från varandra? Det är hela risken. Att en deskriptor tål
 * suddighet är lätt; att den kan peka ut RÄTT Charizard bland 111 är svårt.
 *
 * Varför pröva det här FÖRE en CLIP/DINOv2-modell: går det, slipper vi ladda ner
 * ~35 MB modell i PWA:n, matchningen körs i ren canvas-JS på klienten i
 * millisekunder, den funkar offline och kostar noll per skanning. Ett neuralt
 * nät är starkare men dyrare i varje avseende — det ska vinna på mätning, inte
 * på att det låter mer avancerat.
 *
 * Deskriptorn är HELA kortet nedskalat, inte ett utsnitt av konstfönstret:
 * full-art-kort (Trainer Gallery, V/VMAX) har konst över hela ytan, så ett
 * fixerat "konstfönster" hade beskurit fel på just de kort vi vet är svåra.
 *
 * Per-kanal standardisering (mean/std) i stället för råa RGB-värden: en
 * skärmfotografering flyttar ljusstyrka och vitbalans, och utan det mäter man
 * mest monitorns färgtemperatur.
 */
import sharp from "sharp";
import {
  GRID_H,
  GRID_W,
  fingerprintFromRgb,
  toUnitVector,
} from "../../src/lib/art-fingerprint";


export interface DescriptorConfig {
  label: string;
  gw: number;
  gh: number;
}

/**
 * Tre storlekar som spänner ett brett intervall — poängen är TRENDEN, inte den
 * enskilda siffran. Går träffsäkerheten upp med rutnätet ligger informationen i
 * finare struktur (och då kan ett neuralt nät vara värt det); planar den ut är
 * grov färglayout allt deskriptorn har, och kort som liknar varandra i färg
 * (orange drake i mitten) går inte att skilja hur mycket upplösning man än ger.
 */
export const CONFIGS: DescriptorConfig[] = [
  { label: "grid8x11", gw: 8, gh: 11 },
  { label: "grid16x22", gw: 16, gh: 22 },
  { label: "grid24x33", gw: 24, gh: 33 },
];

/**
 * Kortets fingeravtryck.
 *
 * `grid8x11` går genom den DELADE produktionskoden (`src/lib/art-fingerprint.ts`)
 * — inklusive int8-kvantiseringen — så siffran mäter exakt det som ska skickas,
 * inte en snarlik forskningsvariant. De grövre/finare rutnäten finns bara kvar för
 * att visa trenden och använder en lokal float-variant.
 */
export async function descriptor(
  buf: Buffer,
  { gw, gh }: DescriptorConfig
): Promise<Float32Array | null> {
  // INGEN mellanliggande omskalning. Avkoda i NATIV storlek och låt den delade
  // koden boxmedelvärda hela vägen ner till rutnätet.
  //
  // ⛔ Ett mellansteg (t.ex. resize till 96×132) hade smugit in bibliotekets
  // omsamplingsfilter i nyckeln: servern skalar med sharp, klienten med canvas,
  // och de filtren är inte samma. Då hade referens och fråga räknats olika — exakt
  // den tysta avvikelse som `Card.numberSortKey` har ett parvis test för. Med
  // boxmedelvärde från rå upplösning är aritmetiken identisk på båda sidor.
  let raw: { data: Buffer; info: { width: number; height: number } };
  try {
    raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }

  if (gw === GRID_W && gh === GRID_H) {
    const fp = fingerprintFromRgb(raw.data, raw.info.width, raw.info.height, 3);
    return fp ? toUnitVector(fp) : null;
  }

  // Trendvariant (float, ingen kvantisering) för andra rutnätsstorlekar.
  const n = gw * gh;
  const sums = new Float64Array(n * 3);
  const counts = new Uint32Array(n);
  const { width, height } = raw.info;
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, Math.floor((y * gh) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / width));
      const cell = gy * gw + gx;
      const p = (y * width + x) * 3;
      sums[cell * 3] += raw.data[p];
      sums[cell * 3 + 1] += raw.data[p + 1];
      sums[cell * 3 + 2] += raw.data[p + 2];
      counts[cell]++;
    }
  }
  const out = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) {
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i++) vals[i] = counts[i] ? sums[i * 3 + c] / counts[i] : 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += vals[i];
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) varSum += (vals[i] - mean) ** 2;
    const std = Math.sqrt(varSum / n) || 1;
    for (let i = 0; i < n; i++) out[c * n + i] = (vals[i] - mean) / std;
  }
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/**
 * Simulerar en SKÄRMFOTOGRAFERING — det svåra fallet vi mätt i verkligheten.
 *
 * Kedjan speglar vad som faktiskt händer: butikens produktbild är redan liten
 * och JPEG-komprimerad, den visas på en monitor, och telefonen fotograferar
 * skärmen på nytt med lite skakning, snedhet och färgstick.
 *
 * ⚠️ ÄRLIGHET OM VAD DET HÄR MÄTER: frågebilden kommer från SAMMA fil som
 * referensen, så siffran är ett TAK, inte en verklig träffsäkerhet. Den mäter
 * (a) om deskriptorn kan särskilja 20 563 lika kort och (b) om den tål de
 * försämringar vi valt att lägga på. Moiré från monitorns pixelraster går inte
 * att simulera trovärdigt, och en riktig fångst har annan skärpa och beskärning.
 * Faller det HÄR faller det säkert i verkligheten; klarar det sig här måste det
 * mätas på riktiga fångster innan något byggs.
 */
export interface DegradeProfile {
  label: string;
  /** Bredd produktbilden visas i på skärmen — huvudspaken för detaljförlust. */
  screenW: number;
  screenQuality: number;
  blur: number;
  /** Extra beskärningsglapp och färgdrift. */
  jitter: number;
  finalQuality: number;
}

/**
 * MILD speglar den försämring vi kan motivera från bilddata. HARSH är kalibrerad
 * mot den RIKTIGA fångst ägaren skickade (2026-07-29), som var märkbart suddigare
 * än MILD: monitorns moiré, sämre fokus och en produktbild som redan var liten.
 * Att rapportera båda är hela poängen — MILD ensam är en optimistisk siffra, och
 * en optimistisk siffra som ser ut som ett godkännande är värre än ingen siffra.
 */
export const PROFILES: Record<string, DegradeProfile> = {
  mild: { label: "mild", screenW: 300, screenQuality: 55, blur: 1.1, jitter: 0.04, finalQuality: 80 },
  harsh: { label: "harsh", screenW: 200, screenQuality: 35, blur: 2.4, jitter: 0.07, finalQuality: 62 },
};

export async function degradeAsScreenPhoto(
  buf: Buffer,
  seed: number,
  profile: DegradeProfile = PROFILES.mild
): Promise<Buffer | null> {
  // Deterministiskt "slumpmässigt" per kort så körningar går att jämföra.
  const rnd = (i: number) => {
    const x = Math.sin(seed * 7919 + i * 104729) * 43758.5453;
    return x - Math.floor(x);
  };
  try {
    // 1. Produktbilden som den visas på skärmen: liten och komprimerad.
    const onScreen = await sharp(buf)
      .removeAlpha()
      .resize(profile.screenW, Math.round(profile.screenW * 1.397), { fit: "fill" })
      .jpeg({ quality: profile.screenQuality })
      .toBuffer();

    // 2. Telefonen fotograferar skärmen: uppskalning, oskärpa, snedhet.
    const angle = (rnd(1) - 0.5) * 3; // ±1,5°
    const rotated = await sharp(onScreen)
      .resize(1349, 1889, { fit: "fill", kernel: "cubic" })
      .blur(profile.blur + rnd(2) * 0.6)
      .rotate(angle, { background: { r: 20, g: 20, b: 24 } })
      .toBuffer();

    // 3. Beskärningen träffar aldrig exakt — marginalglapp.
    const meta = await sharp(rotated).metadata();
    const W = meta.width ?? 1349;
    const H = meta.height ?? 1889;
    const inset = 0.02 + rnd(3) * profile.jitter;
    const left = Math.min(Math.round(W * inset * (0.5 + rnd(4))), W - 8);
    const top = Math.min(Math.round(H * inset * (0.5 + rnd(5))), H - 8);
    // Klamra mot bilden — `extract` utanför kanten kastar, och en krasch här
    // hade tystat bort just de kort där snedheten blev störst.
    const width = Math.max(8, Math.min(Math.round(W * (1 - inset * 1.5)), W - left));
    const height = Math.max(8, Math.min(Math.round(H * (1 - inset * 1.5)), H - top));

    // 4. Monitorns färgtemperatur + kamerans exponering.
    return await sharp(rotated)
      .extract({ left, top, width, height })
      .modulate({
        brightness: 1 - profile.jitter * 3 + rnd(6) * profile.jitter * 6,
        saturation: 1 - profile.jitter * 4 + rnd(7) * profile.jitter * 8,
      })
      .jpeg({ quality: profile.finalQuality })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Cosinuslikhet mellan två L2-normaliserade vektorer. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
