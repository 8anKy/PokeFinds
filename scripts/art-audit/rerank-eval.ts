/**
 * OMRANKNINGS-RACET (Fas 3) — är en geometrisk/finkornig andra-pass över
 * topp-15 värd att bygga? MÄT TAKHÖJDEN FÖRST.
 *
 * Fas 3 i planen är ORB/RANSAC över topp-15 (on-demand, aldrig resident).
 * Innan den byggs mäts två saker på den kalibrerade skärmbenchmarken:
 *
 *   1. TAKHÖJDEN: hur ofta ligger facit i topp-15 utan att vara etta? En
 *      PERFEKT omrankning kan aldrig vinna mer än så.
 *   2. En BILLIG proxy: finkornig gradient (16×22×8 = 2816 dim, 4× finare än
 *      produktionens 704) räknad ON-DEMAND på bara de 15 kandidatbilderna.
 *      Finare rutnät är MÄTT SÄMRE som hämtningsdeskriptor (98,3 % mot
 *      99,7 %) — men det var som GLOBALT index. Bakom en robust kortlista är
 *      läget ett annat: kortlistan absorberar robusthetsproblemet, och
 *      findetaljerna får skilja syskon åt. Det är tvåstegs-designen från
 *      copy-detection-litteraturen (global kortlista → parvis verifiering).
 *
 * ⚠️ Identiska tryckningar (Base Unlimited/Shadowless/1st Ed, TG-omtryck med
 * samma konst) kan INGEN bildomrankning skilja — det är numrets jobb. Talen
 * här gäller olika-konst-förväxlingar (blå-vattenkorts-familjen).
 *
 *   QUERIES=100 npx tsx scripts/art-audit/rerank-eval.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { fingerprintFromRgb, toUnitVector } from "../../src/lib/art-fingerprint";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";
import {
  addScreenArtifacts,
  boxMeanGray,
  dctSignDescriptor,
  gradDescriptor,
} from "./screen-descriptors";

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
}

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const REF_DIR = process.env.REF_DIR ?? ".spike/screen-refs";
const REF_VERSION = "v1";
const QUERIES = Number(process.env.QUERIES ?? "100");
const K = 15;

const DIMS = { colorgrid: 264, dctb: 255, grad: 704 } as const;
type Kind = keyof typeof DIMS;

/** Finkornig gradient: 16×22 celler × 8 fack = 2816 dim. Samma aritmetik som
 *  produktions-grad, bara tätare rutnät (192×264-grid). */
function fineGrad(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number
): Float32Array {
  const GW = 192;
  const GH = 264;
  const CX = 16;
  const CY = 22;
  const BINS = 8;
  const gray = boxMeanGray(data, width, height, channels, GW, GH);
  const out = new Float32Array(CX * CY * BINS);
  const cw = GW / CX;
  const ch = GH / CY;
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const gx = gray[y * GW + x + 1] - gray[y * GW + x - 1];
      const gy = gray[(y + 1) * GW + x] - gray[(y - 1) * GW + x];
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag === 0) continue;
      let ang = Math.atan2(gy, gx);
      if (ang < 0) ang += Math.PI;
      const bin = Math.min(BINS - 1, Math.floor((ang / Math.PI) * BINS));
      const cellX = Math.min(CX - 1, Math.floor(x / cw));
      const cellY = Math.min(CY - 1, Math.floor(y / ch));
      out[(cellY * CX + cellX) * BINS + bin] += Math.sqrt(mag);
    }
  }
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

function loadRefs(): { ids: string[]; mats: Record<Kind, Float32Array> } {
  const idsPath = join(REF_DIR, `ids-${REF_VERSION}.json`);
  const kinds = Object.keys(DIMS) as Kind[];
  if (!existsSync(idsPath) || kinds.some((k) => !existsSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`)))) {
    throw new Error("referenscache saknas — kör screen-eval.ts först");
  }
  const ids: string[] = JSON.parse(readFileSync(idsPath, "utf8"));
  const mats = {} as Record<Kind, Float32Array>;
  for (const k of kinds) {
    const raw = readFileSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`));
    mats[k] = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  }
  return { ids, mats };
}

const fineCache = new Map<string, Float32Array | null>();
async function fineFor(id: string): Promise<Float32Array | null> {
  const hit = fineCache.get(id);
  if (hit !== undefined) return hit;
  const p = cachePath(CACHE, id);
  let v: Float32Array | null = null;
  if (existsSync(p)) {
    try {
      const raw = await sharp(readFileSync(p)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      v = fineGrad(raw.data, raw.info.width, raw.info.height, 3);
    } catch {
      v = null;
    }
  }
  fineCache.set(id, v);
  return v;
}

function cos(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const refs = loadRefs();
  const idxById = new Map(refs.ids.map((id, i) => [id, i]));
  const available = cards.filter((c) => idxById.has(c.id) && existsSync(cachePath(CACHE, c.id)));

  const stride = Math.max(1, Math.floor(available.length / QUERIES));
  const queryCards: Card[] = [];
  for (let i = 0; i < available.length && queryCards.length < QUERIES; i += stride) {
    queryCards.push(available[i]);
  }

  let n = 0;
  let top1Base = 0;
  let inTop15 = 0;
  let headroom = 0; // facit i topp-15 men inte etta = det en omrankning kan vinna
  let top1Fine = 0; // ren finkornig omrankning av topp-15
  let top1Blend = 0; // triw + 0,5·fin — behåller kortlistans robusthet
  for (const [qi, qcard] of queryCards.entries()) {
    const degraded = await degradeAsScreenPhoto(
      readFileSync(cachePath(CACHE, qcard.id)),
      qi + 1,
      PROFILES.mild
    );
    if (!degraded) continue;
    const withArtifacts = await addScreenArtifacts(degraded, qi + 1);
    if (!withArtifacts) continue;
    let raw: { data: Buffer; info: { width: number; height: number } };
    try {
      raw = await sharp(withArtifacts).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch {
      continue;
    }
    const { width: w, height: h } = raw.info;
    const fp = fingerprintFromRgb(raw.data, w, h, 3);
    if (!fp) continue;
    const q = {
      colorgrid: toUnitVector(fp),
      dctb: dctSignDescriptor(raw.data, w, h, 3),
      grad: gradDescriptor(raw.data, w, h, 3),
    };
    const selfIdx = idxById.get(qcard.id);
    if (selfIdx === undefined) continue;
    n++;

    // triw-poäng mot hela katalogen → topp-15.
    const scores = new Float64Array(refs.ids.length);
    for (let i = 0; i < refs.ids.length; i++) {
      let s = 0;
      let acc = 0;
      for (let j = 0; j < 264; j++) acc += q.colorgrid[j] * refs.mats.colorgrid[i * 264 + j];
      s += 0.25 * acc;
      acc = 0;
      for (let j = 0; j < 255; j++) acc += q.dctb[j] * refs.mats.dctb[i * 255 + j];
      s += 0.25 * acc;
      acc = 0;
      for (let j = 0; j < 704; j++) acc += q.grad[j] * refs.mats.grad[i * 704 + j];
      s += 0.5 * acc;
      scores[i] = s;
    }
    const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, K);
    if (order[0] === selfIdx) top1Base++;
    const pos = order.indexOf(selfIdx);
    if (pos >= 0) inTop15++;
    if (pos > 0) headroom++;
    if (pos < 0) continue; // utanför kortlistan — ingen omrankning kan rädda det

    // Finkornig omrankning av kortlistan (frågans findeskriptor × 15 kandidater).
    const qFine = fineGrad(raw.data, w, h, 3);
    let bestFine = -Infinity;
    let bestFineI = -1;
    let bestBlend = -Infinity;
    let bestBlendI = -1;
    for (const i of order) {
      const cand = await fineFor(refs.ids[i]);
      if (!cand) continue;
      const f = cos(qFine, cand);
      if (f > bestFine) {
        bestFine = f;
        bestFineI = i;
      }
      const bl = scores[i] + 0.5 * f;
      if (bl > bestBlend) {
        bestBlend = bl;
        bestBlendI = i;
      }
    }
    if (bestFineI === selfIdx) top1Fine++;
    if (bestBlendI === selfIdx) top1Blend++;
  }

  const pct = (x: number) => `${((x / Math.max(1, n)) * 100).toFixed(1)}%`;
  console.log(`n=${n}`);
  console.log(`triw topp-1:              ${pct(top1Base)}`);
  console.log(`triw topp-15:             ${pct(inTop15)}`);
  console.log(`TAKHÖJD (i 15, ej etta):  ${pct(headroom)}  ← max en omrankning kan vinna`);
  console.log(`omrank REN fin (2816d):   ${pct(top1Fine)}`);
  console.log(`omrank triw + 0,5·fin:    ${pct(top1Blend)}`);
  console.log(
    `\nProduktionsnot: on-demand kräver kandidatbilder på servern (finns EJ i prod — ` +
      `CDN-hämtning ~15 bilder/scan) ELLER förberäknade findeskriptorer (2816 × 4 B × 20 431 ≈ 230 MB float32 / ~58 MB int8 resident). ` +
      `Räkna på det MOT uppmätt vinst innan bygge.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
