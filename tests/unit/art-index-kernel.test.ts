import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import wabtInit from "wabt";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { FINGERPRINT_BYTES, STRUCT_BYTES, STRUCT_DCT_DIMS } from "@/lib/art-fingerprint";
import { searchIndexForTest } from "@/services/scanner/art-index";
import { ART_KERNEL_WASM_BASE64 } from "@/services/scanner/art-kernel.generated";

/**
 * SIMD-KÄRNAN FÅR ALDRIG GE ETT ANNAT SVAR ÄN JS-LOOPEN (ägarkrav 2026-11-28: fortare, utan att
 * tappa träffsäkerhet). Här jämförs poängen med `toEqual` — alltså bit för bit, inte "nära nog".
 */

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

/** Hela int8-spannet inklusive −128 (det enda värde vars kvadrat inte ryms i 14 bitar). */
function int8(r: () => number) {
  return Math.max(-128, Math.min(127, Math.round(r() * 128)));
}

function makeIndex(n: number, seed: number) {
  const r = rng(seed);
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  const data = Int8Array.from({ length: n * FINGERPRINT_BYTES }, () => int8(r));
  // Var sjunde rad saknar strukturavtryck (nollor, norm 0) — som kort före backfillen.
  const struct = Int8Array.from({ length: n * STRUCT_BYTES }, (_, i) =>
    Math.floor(i / STRUCT_BYTES) % 7 === 0 ? 0 : int8(r)
  );
  // Två identiska rader ⇒ exakt lika poäng: ordningen mellan dem ska också bli densamma.
  data.copyWithin(11 * FINGERPRINT_BYTES, 10 * FINGERPRINT_BYTES, 11 * FINGERPRINT_BYTES);
  struct.copyWithin(11 * STRUCT_BYTES, 10 * STRUCT_BYTES, 11 * STRUCT_BYTES);
  const invNorm = new Float32Array(n);
  const invDct = new Float32Array(n);
  const invGrad = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let a = 0;
    let d = 0;
    let g = 0;
    for (let i = 0; i < FINGERPRINT_BYTES; i++) a += data[k * FINGERPRINT_BYTES + i] ** 2;
    for (let i = 0; i < STRUCT_BYTES; i++) {
      const v = struct[k * STRUCT_BYTES + i] ** 2;
      if (i < STRUCT_DCT_DIMS) d += v;
      else g += v;
    }
    invNorm[k] = a > 0 ? 1 / Math.sqrt(a) : 0;
    invDct[k] = d > 0 ? 1 / Math.sqrt(d) : 0;
    invGrad[k] = g > 0 ? 1 / Math.sqrt(g) : 0;
  }
  return { ids, data, invNorm, struct, invDct, invGrad };
}

describe("bildsökningens SIMD-kärna", () => {
  // 1 300 rader: flera block om 256 plus ett ofullständigt sista block.
  const index = makeIndex(1300, 3);
  const r = rng(41);
  const query = (withStruct = true) => ({
    color: Int8Array.from({ length: FINGERPRINT_BYTES }, () => int8(r)),
    struct: withStruct ? Int8Array.from({ length: STRUCT_BYTES }, () => int8(r)) : null,
  });

  it("ger exakt samma topplistor och poäng som JS-loopen — med och utan struktur, olika k", () => {
    const queries = [
      { query: query(), k: 10 },
      { query: query(false), k: 10 },
      { query: query(), k: 1 },
      { query: query(), k: 30 },
      // En indexrad som fråga: perfekt träff + dess identiska tvilling på exakt samma poäng.
      {
        query: {
          color: index.data.slice(10 * FINGERPRINT_BYTES, 11 * FINGERPRINT_BYTES),
          struct: index.struct.slice(10 * STRUCT_BYTES, 11 * STRUCT_BYTES),
        },
        k: 5,
      },
      // k större än indexet ⇒ hela indexet, sorterat.
      { query: query(), k: 2000 },
    ];
    const js = searchIndexForTest(index, queries, "js");
    const kernel = searchIndexForTest(index, queries, "kernel");
    expect(kernel).toEqual(js);
    expect(kernel[4][0].score).toBeCloseTo(1, 5);
    expect(kernel[4].slice(0, 2).map((m) => m.cardId)).toEqual(js[4].slice(0, 2).map((m) => m.cardId));
    expect(kernel[5]).toHaveLength(1300);
  });

  it("fler frågor än en genomgång rymmer (33+) delas upp utan att svaren ändras", () => {
    const queries = Array.from({ length: 70 }, (_, i) => ({ query: query(i % 5 !== 0), k: 10 }));
    expect(searchIndexForTest(index, queries, "kernel")).toEqual(searchIndexForTest(index, queries, "js"));
  });

  it("en fråga utan struktur efter en med struktur ärver inget ur frågeblocket", () => {
    const withStruct = { query: query(), k: 10 };
    const bare = { query: query(false), k: 10 };
    const alone = searchIndexForTest(index, [bare], "js")[0];
    // Samma kärnminne återanvänds inte mellan anropen här, så ordna frågorna i SAMMA anrop: den
    // bara frågan hamnar på en plats som en strukturfråga också skrivs till i nästa block om 32.
    const many = [...Array.from({ length: 32 }, () => withStruct), bare];
    expect(searchIndexForTest(index, many, "kernel")[32]).toEqual(alone);
  });

  it("den incheckade kärnan är byggd ur art-kernel.wat (kör scripts/build-art-kernel.mjs)", async () => {
    const wabt = await wabtInit();
    const wat = readFileSync(join(process.cwd(), "src/services/scanner/art-kernel.wat"), "utf8");
    const built = Buffer.from(
      wabt.parseWat("art-kernel.wat", wat, { simd: true }).toBinary({}).buffer
    ).toString("base64");
    expect(ART_KERNEL_WASM_BASE64).toBe(built);
  });
});
