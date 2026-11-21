import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  BLEND_COLOR,
  BLEND_DCT,
  BLEND_GRAD,
  FINGERPRINT_BYTES,
  STRUCT_BYTES,
  STRUCT_DCT_DIMS,
} from "@/lib/art-fingerprint";
import { searchIndexForTest } from "@/services/scanner/art-index";

/** Deterministisk slump så testet är stabilt. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

function makeIndex(n: number, seed: number) {
  const r = rng(seed);
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  const data = Int8Array.from({ length: n * FINGERPRINT_BYTES }, () => Math.round(r() * 120));
  const struct = Int8Array.from({ length: n * STRUCT_BYTES }, (_, i) =>
    Math.floor(i / STRUCT_BYTES) % 7 === 0 ? 0 : Math.round(r() * 120)
  );
  const invNorm = new Float32Array(n);
  const invDct = new Float32Array(n);
  const invGrad = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let a = 0, d = 0, g = 0;
    for (let i = 0; i < FINGERPRINT_BYTES; i++) a += data[k * FINGERPRINT_BYTES + i] ** 2;
    for (let i = 0; i < STRUCT_BYTES; i++) (i < STRUCT_DCT_DIMS ? (d += struct[k * STRUCT_BYTES + i] ** 2) : (g += struct[k * STRUCT_BYTES + i] ** 2));
    invNorm[k] = 1 / Math.sqrt(a);
    invDct[k] = d > 0 ? 1 / Math.sqrt(d) : 0;
    invGrad[k] = g > 0 ? 1 / Math.sqrt(g) : 0;
  }
  return { ids, data, invNorm, struct, invDct, invGrad };
}

/** Rak referens: poäng för varje kort, sortera, ta k. */
function bruteForce(index: ReturnType<typeof makeIndex>, color: Int8Array, struct: Int8Array | null, k: number) {
  let qn = 0;
  for (const v of color) qn += v * v;
  const qInv = 1 / Math.sqrt(qn);
  let nd = 0, ng = 0;
  if (struct) for (let i = 0; i < STRUCT_BYTES; i++) (i < STRUCT_DCT_DIMS ? (nd += struct[i] ** 2) : (ng += struct[i] ** 2));
  const qd = nd > 0 ? 1 / Math.sqrt(nd) : 0;
  const qg = ng > 0 ? 1 / Math.sqrt(ng) : 0;
  const scores = index.ids.map((id, r) => {
    let dot = 0;
    for (let i = 0; i < FINGERPRINT_BYTES; i++) dot += color[i] * index.data[r * FINGERPRINT_BYTES + i];
    const cos = dot * qInv * index.invNorm[r];
    if (!struct) return { cardId: id, score: cos };
    let dd = 0, dg = 0;
    for (let i = 0; i < STRUCT_DCT_DIMS; i++) dd += struct[i] * index.struct[r * STRUCT_BYTES + i];
    for (let i = STRUCT_DCT_DIMS; i < STRUCT_BYTES; i++) dg += struct[i] * index.struct[r * STRUCT_BYTES + i];
    return { cardId: id, score: BLEND_COLOR * cos + BLEND_DCT * dd * qd * index.invDct[r] + BLEND_GRAD * dg * qg * index.invGrad[r] };
  });
  return scores.sort((a, b) => b.score - a.score).slice(0, k);
}

describe("searchIndexForTest (en genomgång för alla frågor)", () => {
  const index = makeIndex(400, 7);
  const r = rng(99);
  const q = () => ({
    color: Int8Array.from({ length: FINGERPRINT_BYTES }, () => Math.round(r() * 120)),
    struct: Int8Array.from({ length: STRUCT_BYTES }, () => Math.round(r() * 120)),
  });
  const queries = [q(), q(), q(), { ...q(), struct: null }, q()];

  it("ger samma topplista per fråga som en rak genomgång, oavsett hur många frågor som körs samtidigt", () => {
    const ks = [15, 30, 5, 15, 1];
    const fused = searchIndexForTest(index, queries.map((query, i) => ({ query, k: ks[i] })));
    queries.forEach((query, i) => {
      expect(fused[i].map((m) => m.cardId)).toEqual(bruteForce(index, query.color, query.struct, ks[i]).map((m) => m.cardId));
      const alone = searchIndexForTest(index, [{ query, k: ks[i] }])[0];
      expect(fused[i]).toEqual(alone);
    });
  });

  it("ogiltig fråga (fel längd, jämn yta) ger tom lista utan att störa grannarna", () => {
    const res = searchIndexForTest(index, [
      { query: { color: new Int8Array(10), struct: null }, k: 5 },
      { query: { color: new Int8Array(FINGERPRINT_BYTES), struct: null }, k: 5 },
      { query: queries[0], k: 5 },
    ]);
    expect(res[0]).toEqual([]);
    expect(res[1]).toEqual([]);
    expect(res[2]).toEqual(searchIndexForTest(index, [{ query: queries[0], k: 5 }])[0]);
  });
});
