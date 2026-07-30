/**
 * SKÄRMFOTO-RACET — mäter deskriptorkandidater mot omrendering (monitor).
 *
 * Skillnaden mot eval.ts: frågorna får OCKSÅ moiré + färgstick
 * (addScreenArtifacts) — de artefakter degradeAsScreenPhoto uttryckligen inte
 * modellerar, och som replay av RIKTIGA skanningar visade fäller färg-griden
 * (topp-5 utan rätt kort för klassiska ramar; tio blå vattenkort inom 0,05).
 *
 * KALIBRERING FÖRE SLUTSATS: profilen är trovärdig först när baslinjen
 * (colorgrid) misslyckas HÄR på samma sätt som den mätt misslyckas i
 * verkligheten — Gyarados · Deoxys ska falla ur topp-5 medan Charizard Base
 * och TG-korten klarar sig. Därför pinnas de verkliga fallen in i frågorna
 * och rapporteras individuellt.
 *
 *   QUERIES=200 npx tsx scripts/art-audit/screen-eval.ts
 *   ONLY=grad …            # en kandidat
 *   REBUILD=1 …            # bygg om referenscachen (efter deskriptoränding)
 *   PROFILE=harsh SKIP_ARTIFACTS=1 …  # gamla fysisk-stil-benchmarken (regressionsgrind)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { fingerprintFromRgb, toUnitVector } from "../../src/lib/art-fingerprint";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";
import {
  addFingerOcclusion,
  addScreenArtifacts,
  dctDescriptor,
  dctSignDescriptor,
  gradDescriptor,
  gradRegionalScore,
} from "./screen-descriptors";

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
  url: string;
}

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const REF_DIR = process.env.REF_DIR ?? ".spike/screen-refs";
const QUERIES = Number(process.env.QUERIES ?? "200");
const ONLY = process.env.ONLY ?? "";
const REBUILD = process.env.REBUILD === "1";
/** Bumpa när en deskriptor ändras — annars läses gammal cache. */
const REF_VERSION = "v1";

/** De VERKLIGA fallen ur telemetrin — kalibreringsankare, pinnas i frågorna. */
const PINNED: Array<{ name: string; set: string }> = [
  { name: "Gyarados", set: "Deoxys" }, // mätt: färg-griden FALLERAR (utanför topp-5)
  { name: "Charizard", set: "Base" }, // mätt: färg-griden klarar (0,83 plats 1)
  { name: "Shedinja", set: "Deoxys" }, // mätt: klarar på bra ruta (0,81), faller på dålig
  { name: "Falinks", set: "Astral Radiance Trainer Gallery" }, // mätt: SÄKER
  { name: "Gyarados", set: "151" }, // modern kontroll
];

type Desc = (data: Buffer, w: number, h: number, ch: 3 | 4) => Float32Array | null;

const KINDS: Record<string, { dim: number; fn: Desc }> = {
  colorgrid: {
    dim: 264,
    fn: (d, w, h, ch) => {
      const fp = fingerprintFromRgb(d, w, h, ch);
      return fp ? toUnitVector(fp) : null;
    },
  },
  dct: { dim: 255, fn: (d, w, h, ch) => dctDescriptor(d, w, h, ch) },
  dctb: { dim: 255, fn: (d, w, h, ch) => dctSignDescriptor(d, w, h, ch) },
  grad: { dim: 704, fn: (d, w, h, ch) => gradDescriptor(d, w, h, ch) },
};

/** combo = colorgrid ⊕ grad, lika viktade (båda redan L2). */
function combo(a: Float32Array | null, b: Float32Array | null): Float32Array | null {
  if (!a || !b) return null;
  const out = new Float32Array(a.length + b.length);
  const s = Math.SQRT1_2;
  for (let i = 0; i < a.length; i++) out[i] = a[i] * s;
  for (let i = 0; i < b.length; i++) out[a.length + i] = b[i] * s;
  return out;
}

async function decodeRaw(buf: Buffer) {
  try {
    return await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }
}

interface RefSet {
  ids: string[];
  mats: Record<string, Float32Array>; // kind → packad matris (n × dim)
}

async function buildRefs(available: Card[]): Promise<RefSet> {
  mkdirSync(REF_DIR, { recursive: true });
  const idsPath = join(REF_DIR, `ids-${REF_VERSION}.json`);
  const kindNames = Object.keys(KINDS);
  const allCached =
    !REBUILD &&
    existsSync(idsPath) &&
    kindNames.every((k) => existsSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`)));
  if (allCached) {
    const ids: string[] = JSON.parse(readFileSync(idsPath, "utf8"));
    const mats: Record<string, Float32Array> = {};
    for (const k of kindNames) {
      const raw = readFileSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`));
      mats[k] = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    }
    console.log(`referenscache läst: ${ids.length} kort`);
    return { ids, mats };
  }

  console.log("bygger referensmatriser (en avkodning per bild) …");
  const ids: string[] = [];
  const cols: Record<string, Float32Array[]> = Object.fromEntries(
    kindNames.map((k) => [k, []])
  );
  let done = 0;
  for (const card of available) {
    const raw = await decodeRaw(readFileSync(cachePath(CACHE, card.id)));
    if (!raw) continue;
    const vecs: Record<string, Float32Array | null> = {};
    for (const k of kindNames) {
      vecs[k] = KINDS[k].fn(raw.data, raw.info.width, raw.info.height, 3);
    }
    if (kindNames.some((k) => !vecs[k])) continue;
    ids.push(card.id);
    for (const k of kindNames) cols[k].push(vecs[k]!);
    if (++done % 2000 === 0) console.log(`  ${done} …`);
  }
  const mats: Record<string, Float32Array> = {};
  for (const k of kindNames) {
    const dim = KINDS[k].dim;
    const m = new Float32Array(ids.length * dim);
    cols[k].forEach((v, i) => m.set(v, i * dim));
    mats[k] = m;
    writeFileSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`), Buffer.from(m.buffer));
  }
  writeFileSync(idsPath, JSON.stringify(ids));
  console.log(`referenser: ${ids.length} kort (cachade till ${REF_DIR})`);
  return { ids, mats };
}

function rankAgainst(
  mat: Float32Array,
  dim: number,
  n: number,
  q: Float32Array
): { scores: Float64Array; bestI: number; secondScore: number } {
  const scores = new Float64Array(n);
  let bestI = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j++) s += q[j] * mat[base + j];
    scores[i] = s;
    if (s > scores[bestI]) bestI = i;
  }
  let second = -Infinity;
  for (let i = 0; i < n; i++) if (i !== bestI && scores[i] > second) second = scores[i];
  return { scores, bestI, secondScore: second };
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const available = cards.filter((c) => existsSync(cachePath(CACHE, c.id)));
  console.log(`katalog: ${cards.length} · cachade: ${available.length}`);

  const refs = await buildRefs(available);
  const idxById = new Map(refs.ids.map((id, i) => [id, i]));
  const cardById = new Map(available.map((c) => [c.id, c]));

  // Frågor: pinnade verkliga fall + deterministiskt uniformt urval.
  const pinned = PINNED.flatMap((p) => {
    const hit = available.find((c) => c.name === p.name && c.set === p.set);
    if (!hit) console.warn(`⚠️ pinnat kort saknas i cachen: ${p.name} (${p.set})`);
    return hit ? [hit] : [];
  });
  const stride = Math.max(1, Math.floor(available.length / QUERIES));
  const queryCards: Card[] = [...pinned];
  for (let i = 0; i < available.length && queryCards.length < QUERIES + pinned.length; i += stride) {
    if (!pinned.includes(available[i])) queryCards.push(available[i]);
  }
  console.log(`frågor: ${queryCards.length} (varav ${pinned.length} pinnade)\n`);

  const kindNames = [
    ...Object.keys(KINDS),
    "combo",
    "combo2",
    "tri",
    "comax",
    "triw",
    "rrf",
    "triwr",
  ].filter((k) => !ONLY || k === ONLY);
  const stats = Object.fromEntries(
    kindNames.map((k) => [
      k,
      {
        top1: 0,
        top5: 0,
        top15: 0,
        n: 0,
        wrongMargins: [] as number[],
        rightMargins: [] as number[],
      },
    ])
  );
  const pinnedReport: string[] = [];

  for (const [qi, qcard] of queryCards.entries()) {
    // MILD som bas: de riktiga fångsterna var inte suddiga (ström 2160×3840,
    // effektiv källa ~370 px) — det var SKÄRMARTEFAKTERNA som fällde färg-
    // griden, inte upplösningen. addScreenArtifacts bär det svåra.
    // PROFILE/SKIP_ARTIFACTS = regressionsgrind mot gamla fysisk-benchmarken.
    const degraded = await degradeAsScreenPhoto(
      readFileSync(cachePath(CACHE, qcard.id)),
      qi + 1,
      PROFILES[process.env.PROFILE ?? "mild"] ?? PROFILES.mild
    );
    if (!degraded) continue;
    let withArtifacts =
      process.env.SKIP_ARTIFACTS === "1"
        ? degraded
        : await addScreenArtifacts(degraded, qi + 1);
    if (!withArtifacts) continue;
    // OCCLUDE=1 → ett finger täcker en kant (mätt produktionsfall 2026-07-31).
    if (process.env.OCCLUDE === "1") {
      withArtifacts = await addFingerOcclusion(withArtifacts, qi + 1);
      if (!withArtifacts) continue;
    }
    const raw = await decodeRaw(withArtifacts);
    if (!raw) continue;

    const qvecs: Record<string, Float32Array | null> = {};
    for (const k of Object.keys(KINDS)) {
      qvecs[k] = KINDS[k].fn(raw.data, raw.info.width, raw.info.height, 3);
    }
    qvecs.combo = combo(qvecs.colorgrid, qvecs.grad);
    qvecs.combo2 = combo(qvecs.dctb, qvecs.grad);
    // tri = alla tre delarna lika viktade (1/√3 vardera).
    if (qvecs.colorgrid && qvecs.dctb && qvecs.grad) {
      const parts = [qvecs.colorgrid, qvecs.dctb, qvecs.grad];
      const dim = parts.reduce((s, p) => s + p.length, 0);
      const tri = new Float32Array(dim);
      const w = 1 / Math.sqrt(3);
      let off = 0;
      for (const p of parts) {
        for (let i = 0; i < p.length; i++) tri[off + i] = p[i] * w;
        off += p.length;
      }
      qvecs.tri = tri;
    } else {
      qvecs.tri = null;
    }

    const selfIdx = idxById.get(qcard.id);
    if (selfIdx === undefined) continue;

    const COMBOS: Record<string, string[]> = {
      combo: ["colorgrid", "grad"],
      combo2: ["dctb", "grad"],
      tri: ["colorgrid", "dctb", "grad"],
    };
    const comboDim = (parts: string[]) => parts.reduce((s, p) => s + KINDS[p].dim, 0);
    const ensureComboMat = (k: string) => {
      if (refs.mats[k]) return;
      const parts = COMBOS[k];
      const dim = comboDim(parts);
      const w = 1 / Math.sqrt(parts.length);
      const m = new Float32Array(refs.ids.length * dim);
      for (let i = 0; i < refs.ids.length; i++) {
        let off = 0;
        for (const p of parts) {
          const dp = KINDS[p].dim;
          const src = refs.mats[p];
          for (let j = 0; j < dp; j++) m[i * dim + off + j] = src[i * dp + j] * w;
          off += dp;
        }
      }
      refs.mats[k] = m;
    };

    for (const k of kindNames) {
      let scores: Float64Array;
      let bestI: number;
      let secondScore: number;
      if (k === "triwr") {
        // triw med REGIONAL grad: fingrets region kastas som outlier.
        if (!qvecs.colorgrid || !qvecs.dctb || !qvecs.grad) continue;
        const pa = rankAgainst(refs.mats.colorgrid, KINDS.colorgrid.dim, refs.ids.length, qvecs.colorgrid);
        const pb = rankAgainst(refs.mats.dctb, KINDS.dctb.dim, refs.ids.length, qvecs.dctb);
        scores = new Float64Array(refs.ids.length);
        const gm = refs.mats.grad;
        const qg = qvecs.grad;
        for (let i = 0; i < refs.ids.length; i++) {
          const row = gm.subarray(i * 704, (i + 1) * 704);
          scores[i] =
            0.25 * pa.scores[i] + 0.25 * pb.scores[i] + 0.5 * gradRegionalScore(qg, row);
        }
        bestI = 0;
        for (let i = 0; i < refs.ids.length; i++) if (scores[i] > scores[bestI]) bestI = i;
        secondScore = -Infinity;
        for (let i = 0; i < refs.ids.length; i++) {
          if (i !== bestI && scores[i] > secondScore) secondScore = scores[i];
        }
      } else if (k === "triw" || k === "rrf") {
        // triw: viktat MEDEL av del-cosinus (grad är ryggraden → halva vikten).
        // rrf: reciprocal rank fusion av de två experterna — rangordning i
        // stället för poäng, så experternas ojämförbara skalor inte spelar roll
        // (det som fällde comax).
        if (!qvecs.colorgrid || !qvecs.dctb || !qvecs.grad) continue;
        const pa = rankAgainst(refs.mats.colorgrid, KINDS.colorgrid.dim, refs.ids.length, qvecs.colorgrid);
        const pb = rankAgainst(refs.mats.dctb, KINDS.dctb.dim, refs.ids.length, qvecs.dctb);
        const pc = rankAgainst(refs.mats.grad, KINDS.grad.dim, refs.ids.length, qvecs.grad);
        scores = new Float64Array(refs.ids.length);
        if (k === "triw") {
          for (let i = 0; i < refs.ids.length; i++) {
            scores[i] = 0.25 * pa.scores[i] + 0.25 * pb.scores[i] + 0.5 * pc.scores[i];
          }
        } else {
          const rankOf = (arr: Float64Array) => {
            const order = [...arr.keys()].sort((x, y) => arr[y] - arr[x]);
            const r = new Int32Array(arr.length);
            order.forEach((idx, pos) => (r[idx] = pos));
            return r;
          };
          // Experterna, inte delarna: combo (fysisk) + combo2 (skärm).
          if (!qvecs.combo || !qvecs.combo2) continue;
          ensureComboMat("combo");
          ensureComboMat("combo2");
          const ea = rankAgainst(refs.mats.combo, comboDim(COMBOS.combo), refs.ids.length, qvecs.combo);
          const eb = rankAgainst(refs.mats.combo2, comboDim(COMBOS.combo2), refs.ids.length, qvecs.combo2);
          const ra = rankOf(ea.scores);
          const rb = rankOf(eb.scores);
          for (let i = 0; i < refs.ids.length; i++) {
            scores[i] = 1 / (60 + ra[i]) + 1 / (60 + rb[i]);
          }
        }
        bestI = 0;
        for (let i = 0; i < refs.ids.length; i++) if (scores[i] > scores[bestI]) bestI = i;
        secondScore = -Infinity;
        for (let i = 0; i < refs.ids.length; i++) {
          if (i !== bestI && scores[i] > secondScore) secondScore = scores[i];
        }
      } else if (k === "comax") {
        // MAX-AV-TVÅ-EXPERTER: en fångst är antingen skärm- eller fysisk-lik;
        // rätt expert (combo2 resp. combo) får göra anspråk på varje kort.
        if (!qvecs.combo || !qvecs.combo2) continue;
        ensureComboMat("combo");
        ensureComboMat("combo2");
        const a = rankAgainst(
          refs.mats.combo, comboDim(COMBOS.combo), refs.ids.length, qvecs.combo
        );
        const b = rankAgainst(
          refs.mats.combo2, comboDim(COMBOS.combo2), refs.ids.length, qvecs.combo2
        );
        scores = new Float64Array(refs.ids.length);
        bestI = 0;
        for (let i = 0; i < refs.ids.length; i++) {
          scores[i] = Math.max(a.scores[i], b.scores[i]);
          if (scores[i] > scores[bestI]) bestI = i;
        }
        secondScore = -Infinity;
        for (let i = 0; i < refs.ids.length; i++) {
          if (i !== bestI && scores[i] > secondScore) secondScore = scores[i];
        }
      } else {
        const q = qvecs[k];
        if (!q) continue;
        let mat = refs.mats[k];
        let dim = KINDS[k]?.dim ?? 0;
        if (COMBOS[k]) {
          ensureComboMat(k);
          mat = refs.mats[k];
          dim = comboDim(COMBOS[k]);
        }
        ({ scores, bestI, secondScore } = rankAgainst(mat, dim, refs.ids.length, q));
      }
      const selfScore = scores[selfIdx];
      let rank = 0;
      for (let i = 0; i < refs.ids.length; i++) if (scores[i] > selfScore) rank++;

      const st = stats[k];
      st.n++;
      if (rank === 0) st.top1++;
      if (rank < 5) st.top5++;
      if (rank < 15) st.top15++;
      const margin = scores[bestI] - secondScore;
      if (rank === 0) st.rightMargins.push(margin);
      else st.wrongMargins.push(margin);

      if (pinned.includes(qcard)) {
        const winner = cardById.get(refs.ids[bestI]);
        pinnedReport.push(
          `  [${k.padEnd(9)}] ${qcard.name} (${qcard.set}): plats ${rank + 1}, ` +
            `topp ${scores[bestI].toFixed(3)} marg ${margin.toFixed(3)}` +
            (rank > 0 && winner ? ` — etta: ${winner.name} (${winner.set})` : "")
        );
      }
    }
  }

  console.log("PINNADE VERKLIGA FALL (kalibrering):");
  for (const line of pinnedReport) console.log(line);
  console.log();

  const med = (xs: number[]) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  for (const k of kindNames) {
    const st = stats[k];
    const pct = (x: number) => `${((x / st.n) * 100).toFixed(1)}%`.padStart(6);
    console.log(
      `[${k.padEnd(9)}] topp-1 ${pct(st.top1)} · topp-5 ${pct(st.top5)} · topp-15 ${pct(st.top15)}` +
        `  (n=${st.n})  rätt-marg med ${med(st.rightMargins).toFixed(3)}` +
        ` · fel-marg max ${st.wrongMargins.length ? Math.max(...st.wrongMargins).toFixed(3) : "–"}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
