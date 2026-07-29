/**
 * REVISION — hjälper det att VIKTA konstfönstret tyngre än ramen?
 *
 * MÄTT PROBLEM (12 riktiga skanningar, 2026-07-30): bilden träffade 4/4 på
 * helbildskort (Trainer Gallery, marginal upp till 0,377) men 0/6 på klassiskt
 * ramade kort (marginal 0,004–0,028). Snittet i den globala revisionen (84 %
 * topp-1) DOLDE den skillnaden helt.
 *
 * Förklaringen är layouten: på ett klassiskt kort är merparten av rutnätets 88
 * celler ram, attacktext och fot — i praktiken identiska mellan alla kort från
 * samma era. Bara konstfönstret (~rad 1–5 av 11) bär särskiljande information. På
 * ett helbildskort fyller konsten alla celler, vilket är precis varför de fungerar.
 *
 * Hypotesen: vikta cellerna i konstfönstret tyngre. Vikterna appliceras vid
 * JÄMFÖRELSEN (i unit-vektorn), inte i det lagrade avtrycket — så ingen ombyggnad
 * av indexet krävs och vikterna är gratis att ändra.
 *
 *   SAMPLES=300 node scripts/with-prod-db.mjs npx tsx scripts/art-audit/weight-audit.ts
 */
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import {
  FINGERPRINT_INSETS,
  GRID_H,
  GRID_W,
  fingerprintFromRgb,
} from "../../src/lib/art-fingerprint";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const SAMPLES = Number(process.env.SAMPLES ?? "250");
const PAD = Number(process.env.PAD ?? "0.03");

interface Card {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: string;
  url: string;
}

/** Helbildskort: konsten täcker hela kortet. Klassiska har ram + textruta. */
function isFullArt(c: Card): boolean {
  if (/^(TG|GG|SV)/i.test(c.number)) return true;
  return /illustration|full art|ultra|secret|hyper|rainbow|special|shiny/i.test(c.rarity ?? "");
}

/**
 * Cellvikter per RAD (11 rader). Konstfönstret på ett klassiskt kort ligger
 * ungefär mellan 11 % och 52 % av kortets höjd, dvs rad 1–5.
 */
function rowWeights(inner: number, outer: number): Float32Array {
  const w = new Float32Array(GRID_W * GRID_H);
  for (let r = 0; r < GRID_H; r++) {
    const yCentre = (r + 0.5) / GRID_H;
    const weight = yCentre >= 0.09 && yCentre <= 0.55 ? inner : outer;
    for (let c = 0; c < GRID_W; c++) w[r * GRID_W + c] = weight;
  }
  return w;
}

const WEIGHT_PROFILES: { label: string; w: Float32Array | null }[] = [
  { label: "flat (nuvarande)", w: null },
  { label: "konst 1,0 / övrigt 0,50", w: rowWeights(1, 0.5) },
  { label: "konst 1,0 / övrigt 0,30", w: rowWeights(1, 0.3) },
  { label: "konst 1,0 / övrigt 0,15", w: rowWeights(1, 0.15) },
];

/** int8-avtryck → viktad, L2-normaliserad vektor. */
function unit(fp: Int8Array, weights: Float32Array | null): Float32Array {
  const cells = GRID_W * GRID_H;
  const v = new Float32Array(fp.length);
  let norm = 0;
  for (let i = 0; i < fp.length; i++) {
    // Vikten gäller CELLEN, och varje cell har tre kanaler efter varandra i
    // block: index i hör till cell (i % cells).
    const wgt = weights ? weights[i % cells] : 1;
    const x = fp[i] * wgt;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < fp.length; i++) v[i] /= norm;
  return v;
}

function cos(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function baseFingerprint(buf: Buffer, inset = 0): Promise<Int8Array | null> {
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return fingerprintFromRgb(data, info.width, info.height, 3, inset);
}

async function main() {
  const all: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const available = all.filter((c) => existsSync(cachePath(CACHE, c.id)));
  if (!available[0]?.rarity) {
    console.error("cards.json saknar rarity — kör dump-cards.ts igen.");
    process.exitCode = 1;
    return;
  }

  // REFERENSER: avkoda EN gång, återanvänd över alla viktprofiler.
  process.stdout.write(`avkodar ${available.length} referenser …`);
  const refFp: Int8Array[] = [];
  const refCards: Card[] = [];
  for (const card of available) {
    const fp = await baseFingerprint(readFileSync(cachePath(CACHE, card.id)));
    if (fp) {
      refFp.push(fp);
      refCards.push(card);
    }
  }
  process.stdout.write(` ${refFp.length}\n`);

  const stride = Math.max(1, Math.floor(refCards.length / SAMPLES));
  const queries: number[] = [];
  for (let i = 0; i < refCards.length && queries.length < SAMPLES; i += stride) queries.push(i);

  // FRÅGOR: försämra + avkoda svepet EN gång, återanvänd över profilerna.
  process.stdout.write(`förbereder ${queries.length} frågor …`);
  const profile = { ...PROFILES.harsh, pad: PAD };
  const queryFps: { idx: number; fps: Int8Array[] }[] = [];
  for (const [k, idx] of queries.entries()) {
    const degraded = await degradeAsScreenPhoto(
      readFileSync(cachePath(CACHE, refCards[idx].id)),
      k + 1,
      profile
    );
    if (!degraded) continue;
    const { data, info } = await sharp(degraded)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fps = FINGERPRINT_INSETS.flatMap((inset) => {
      const fp = fingerprintFromRgb(data, info.width, info.height, 3, inset);
      return fp ? [fp] : [];
    });
    if (fps.length) queryFps.push({ idx, fps });
  }
  process.stdout.write(` ${queryFps.length}\n\n`);

  const full = queryFps.filter((q) => isFullArt(refCards[q.idx])).length;
  console.log(`frågor: ${queryFps.length} (helbild ${full} · klassiska ${queryFps.length - full})`);
  console.log(`profil: harsh + ${(PAD * 100).toFixed(0)} % marginal\n`);
  console.log("viktprofil                   ALLA           HELBILD        KLASSISKA");
  console.log("                          t-1    t-15    t-1    t-15    t-1    t-15");

  for (const { label, w } of WEIGHT_PROFILES) {
    const refVecs = refFp.map((fp) => unit(fp, w));
    const tally = {
      all: { n: 0, t1: 0, t15: 0 },
      fullArt: { n: 0, t1: 0, t15: 0 },
      classic: { n: 0, t1: 0, t15: 0 },
    };

    for (const q of queryFps) {
      // Bästa rang över inset-svepet, som produktionskoden gör.
      let bestRank = Number.POSITIVE_INFINITY;
      for (const fp of q.fps) {
        const qv = unit(fp, w);
        const self = cos(qv, refVecs[q.idx]);
        let rank = 0;
        for (let i = 0; i < refVecs.length; i++) {
          if (i !== q.idx && cos(qv, refVecs[i]) > self) rank++;
        }
        if (rank < bestRank) bestRank = rank;
      }
      const bucket = isFullArt(refCards[q.idx]) ? tally.fullArt : tally.classic;
      for (const t of [tally.all, bucket]) {
        t.n++;
        if (bestRank === 0) t.t1++;
        if (bestRank < 15) t.t15++;
      }
    }

    const p = (t: { n: number; t1: number; t15: number }) =>
      t.n === 0
        ? "  –      –  "
        : `${((t.t1 / t.n) * 100).toFixed(1).padStart(5)}% ${((t.t15 / t.n) * 100).toFixed(1).padStart(5)}%`;
    console.log(
      `${label.padEnd(26)} ${p(tally.all)}  ${p(tally.fullArt)}  ${p(tally.classic)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
