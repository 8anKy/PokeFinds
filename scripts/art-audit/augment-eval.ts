/**
 * AUGMENTERINGS-RACET (Fas 2) — mäter om FLERA referensavtryck per kort
 * (byggda ur augmenterade katalogbilder) höjer träffsäkerheten, och vad varje
 * variant kostar i residentminne — INNAN något byggs in i produktion.
 *
 * Produktionskostnaden är linjär och minne är ~92 % av Railway-notan:
 *   1 extra variant = 20 431 × (264 + 959) B ≈ 25 MB residentminne.
 * Därför rapporteras allt som RECALL-PER-MB, och beslutet är ägarens.
 *
 * ⚠️ ÄRLIGHETSVARNING: frågorna OCH referens-augmenteringen är syntetiska.
 * De delar oundvikligen modellfamilj (skärmtvätt, blur), så talen här är en
 * OPTIMISTISK ÖVRE GRÄNS — referenssidan använder ANDRA frön och mildare
 * parametrar än frågesidan, men en äkta validering kräver Fas 0-facit
 * (scanner-scoreboard.ts + replay). Shippa INGET på de här talen ensamma.
 *
 * MAX per kort över varianter, aldrig medel — samma skäl som inset-svepet:
 * bara EN variant är den rätta, medel drar ner rätt kort med brus.
 *
 *   QUERIES=100 AUG=2 npx tsx scripts/art-audit/augment-eval.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { fingerprintFromRgb, toUnitVector } from "../../src/lib/art-fingerprint";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";
import { addScreenArtifacts, dctSignDescriptor, gradDescriptor } from "./screen-descriptors";

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
const AUG_VERSION = "aug1";
const QUERIES = Number(process.env.QUERIES ?? "100");
/** Antal augmenterade varianter per kort (utöver originalreferensen). */
const AUG = Number(process.env.AUG ?? "2");

const DIMS = { colorgrid: 264, dctb: 255, grad: 704 } as const;
type Kind = keyof typeof DIMS;

/**
 * Referens-augmentering k för kort med index ci: mild skärmtvätt med RUMSLIGT
 * ljus — mekanismen som mätt fäller färgdelen — men med EGEN frö-rymd och
 * mildare parametrar än frågesidans addScreenArtifacts.
 */
async function augmentRef(buf: Buffer, ci: number, k: number): Promise<Buffer | null> {
  const rnd = (i: number) => {
    const x = Math.sin((ci * 7 + k) * 6151 + i * 331999) * 43758.5453;
    return x - Math.floor(x);
  };
  try {
    const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = raw.info;
    const d = raw.data;
    const sat = 0.6 + rnd(1) * 0.3;
    const lift = 10 + rnd(2) * 20;
    const contrast = 0.82 + rnd(3) * 0.12;
    const gradAmp = 0.1 + rnd(4) * 0.15;
    const gradTh = rnd(5) * 2 * Math.PI;
    const gcx = Math.cos(gradTh) / width;
    const gcy = Math.sin(gradTh) / height;
    const vign = 0.05 + rnd(6) * 0.12;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ramp = 1 + gradAmp * ((x - width / 2) * gcx + (y - height / 2) * gcy) * 2;
        const nx = (x / width - 0.5) * 2;
        const ny = (y / height - 0.5) * 2;
        const vig = 1 - vign * (nx * nx + ny * ny);
        const p = (y * width + x) * 3;
        const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        for (let c = 0; c < 3; c++) {
          const desat = lum + (d[p + c] - lum) * sat;
          const v = desat * contrast * ramp * vig + lift;
          d[p + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    return await sharp(d, { raw: { width, height, channels: 3 } })
      .blur(0.6 + rnd(7) * 1.2)
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

function loadBaseRefs(): { ids: string[]; mats: Record<Kind, Float32Array> } {
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

/** Bygger (eller läser cachade) augmenterade referensmatriser för variant k. */
async function buildAugRefs(
  ids: string[],
  k: number
): Promise<Record<Kind, Float32Array> | null> {
  const kinds = Object.keys(DIMS) as Kind[];
  const paths = Object.fromEntries(
    kinds.map((kd) => [kd, join(REF_DIR, `${kd}-${AUG_VERSION}-${k}.bin`)])
  ) as Record<Kind, string>;
  if (kinds.every((kd) => existsSync(paths[kd]))) {
    const mats = {} as Record<Kind, Float32Array>;
    for (const kd of kinds) {
      const raw = readFileSync(paths[kd]);
      mats[kd] = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    }
    console.log(`augmentering ${k}: cache läst`);
    return mats;
  }
  console.log(`augmentering ${k}: bygger (${ids.length} kort — tar en stund) …`);
  const mats = {} as Record<Kind, Float32Array>;
  for (const kd of kinds) mats[kd] = new Float32Array(ids.length * DIMS[kd]);
  let done = 0;
  for (const [ci, id] of ids.entries()) {
    const p = cachePath(CACHE, id);
    if (!existsSync(p)) continue;
    const aug = await augmentRef(readFileSync(p), ci, k);
    if (!aug) continue;
    let raw: { data: Buffer; info: { width: number; height: number } };
    try {
      raw = await sharp(aug).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch {
      continue;
    }
    const { width: w, height: h } = raw.info;
    const fp = fingerprintFromRgb(raw.data, w, h, 3);
    if (!fp) continue;
    mats.colorgrid.set(toUnitVector(fp), ci * 264);
    mats.dctb.set(dctSignDescriptor(raw.data, w, h, 3), ci * 255);
    mats.grad.set(gradDescriptor(raw.data, w, h, 3), ci * 704);
    if (++done % 2000 === 0) console.log(`  ${done} …`);
  }
  for (const kd of kinds) writeFileSync(paths[kd], Buffer.from(mats[kd].buffer));
  console.log(`augmentering ${k}: ${done} kort byggda`);
  return mats;
}

function scoreInto(
  mats: Record<Kind, Float32Array>,
  n: number,
  q: { colorgrid: Float32Array; dctb: Float32Array; grad: Float32Array },
  best: Float64Array
) {
  for (let i = 0; i < n; i++) {
    let s = 0;
    let acc = 0;
    for (let j = 0; j < 264; j++) acc += q.colorgrid[j] * mats.colorgrid[i * 264 + j];
    s += 0.25 * acc;
    acc = 0;
    for (let j = 0; j < 255; j++) acc += q.dctb[j] * mats.dctb[i * 255 + j];
    s += 0.25 * acc;
    acc = 0;
    for (let j = 0; j < 704; j++) acc += q.grad[j] * mats.grad[i * 704 + j];
    s += 0.5 * acc;
    if (s > best[i]) best[i] = s;
  }
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const base = loadBaseRefs();
  const idxById = new Map(base.ids.map((id, i) => [id, i]));
  const available = cards.filter((c) => idxById.has(c.id) && existsSync(cachePath(CACHE, c.id)));

  const augMats: Record<Kind, Float32Array>[] = [];
  for (let k = 0; k < AUG; k++) {
    const m = await buildAugRefs(base.ids, k);
    if (m) augMats.push(m);
  }

  const stride = Math.max(1, Math.floor(available.length / QUERIES));
  const queryCards: Card[] = [];
  for (let i = 0; i < available.length && queryCards.length < QUERIES; i += stride) {
    queryCards.push(available[i]);
  }
  console.log(`frågor: ${queryCards.length} · referensvarianter: 1 + ${augMats.length}`);

  // Per antal använda varianter (0 = bara original): topp-1/5/15.
  const levels = augMats.length + 1;
  const stats = Array.from({ length: levels }, () => ({ top1: 0, top5: 0, top15: 0, n: 0 }));

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

    const best = new Float64Array(base.ids.length).fill(-Infinity);
    scoreInto(base.mats, base.ids.length, q, best);
    for (let level = 0; level < levels; level++) {
      if (level > 0) scoreInto(augMats[level - 1], base.ids.length, q, best);
      const self = best[selfIdx];
      if (!Number.isFinite(self)) continue;
      let rank = 0;
      for (let i = 0; i < best.length; i++) if (best[i] > self) rank++;
      const st = stats[level];
      st.n++;
      if (rank === 0) st.top1++;
      if (rank < 5) st.top5++;
      if (rank < 15) st.top15++;
    }
  }

  const MB_PER_VARIANT = (20431 * (264 + 959)) / 1e6;
  console.log(`\n--- recall per referensvariant (MAX per kort) ---`);
  for (let level = 0; level < levels; level++) {
    const st = stats[level];
    const pct = (x: number) => (st.n ? `${((x / st.n) * 100).toFixed(1)}%`.padStart(6) : "     –");
    const mb = (level * MB_PER_VARIANT).toFixed(0);
    console.log(
      `[original${level > 0 ? ` + ${level} aug` : "      "}] topp-1 ${pct(st.top1)} · topp-5 ${pct(st.top5)} · topp-15 ${pct(st.top15)} (n=${st.n})  +${mb} MB resident`
    );
  }
  console.log(
    `\n⚠️ Övre gräns (syntetisk fråge- OCH referensaugmentering) — beslut kräver Fas 0-facit.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
