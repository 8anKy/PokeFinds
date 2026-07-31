/**
 * INT8-KOLLEN (Fas 0-punkt) — hur mycket flyttar int8-kvantiseringen cosinusen?
 *
 * "int8 kostar inget i recall" har varit ett ANTAGANDE (den externa siffran
 * '<1 % fel' överlevde inte källgranskning). Riktiga fångster bär bara int8,
 * så det mätbara är störningen: för slumpade kortpar jämförs cosinus räknad på
 * float-deskriptorer mot cosinus räknad på produktionens int8-väg (samma
 * bild, samma aritmetik, enda skillnaden är kvantiseringen). Störningen ställs
 * mot marginalregeln (0,10) och den uppmätta fel-marginalen (max 0,028):
 * ligger p99-störningen långt under dem kan kvantiseringen inte ändra utfall.
 *
 *   PAIRS=2000 npx tsx scripts/art-audit/quant-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import {
  STRUCT_DCT_DIMS,
  fingerprintFromRgb,
  structFingerprintFromRgb,
  toUnitVector,
} from "../../src/lib/art-fingerprint";
import { cachePath } from "./cache";
import { gradDescriptor } from "./screen-descriptors";

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const PAIRS = Number(process.env.PAIRS ?? "1000");

interface Card {
  id: string;
}

function cos(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

async function vecs(id: string): Promise<{ gradF: Float32Array; gradQ: Float32Array } | null> {
  const p = cachePath(CACHE, id);
  if (!existsSync(p)) return null;
  let raw: { data: Buffer; info: { width: number; height: number } };
  try {
    raw = await sharp(readFileSync(p)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }
  const { width: w, height: h } = raw.info;
  // FLOAT-vägen: harnessets gradDescriptor (L2-normerad float).
  const gradF = gradDescriptor(raw.data, w, h, 3);
  // INT8-vägen: produktionens strukturavtryck → grad-delen → enhetsvektor.
  const sfp = structFingerprintFromRgb(raw.data, w, h, 3);
  if (!sfp) return null;
  const gradQ = toUnitVector(sfp.subarray(STRUCT_DCT_DIMS));
  // Färgdelen är int8 i BÅDA vägarna redan (fingerprintFromRgb kvantiserar
  // internt) — grad är den enda del där produktionen kvantiserar och
  // harnesset inte gör det, därav fokuset här.
  void fingerprintFromRgb;
  return { gradF, gradQ };
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const step = Math.max(1, Math.floor(cards.length / (PAIRS * 2)));
  const picked: Card[] = [];
  for (let i = 0; i < cards.length && picked.length < PAIRS * 2; i += step) picked.push(cards[i]);

  const errs: number[] = [];
  let selfErrMax = 0;
  for (let i = 0; i + 1 < picked.length; i += 2) {
    const a = await vecs(picked[i].id);
    const b = await vecs(picked[i + 1].id);
    if (!a || !b) continue;
    // Störning på PAR-cosinus (det som rankar) …
    errs.push(Math.abs(cos(a.gradF, b.gradF) - cos(a.gradQ, b.gradQ)));
    // … och på självlikheten (float- mot int8-vägen för samma bild).
    selfErrMax = Math.max(selfErrMax, 1 - cos(a.gradF, a.gradQ), 1 - cos(b.gradF, b.gradQ));
  }
  errs.sort((x, y) => x - y);
  const q = (p: number) => errs[Math.min(errs.length - 1, Math.floor(p * errs.length))];
  console.log(`par: ${errs.length}`);
  console.log(
    `|Δcosinus| median ${q(0.5).toExponential(2)} · p99 ${q(0.99).toExponential(2)} · max ${errs[errs.length - 1].toExponential(2)}`
  );
  console.log(`självlikhet float↔int8, sämsta: ${(1 - selfErrMax).toFixed(6)}`);
  console.log(
    `referens: marginalregeln 0,10 · uppmätt fel-marginal max 0,028 — ligger p99 långt under båda kan int8 inte ändra ett utfall.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
