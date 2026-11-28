/**
 * SIMD-kärnan mot JS-loopen på det RIKTIGA indexet (läser bara).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/art-kernel-verify.ts [antal frågor]
 *
 * Frågorna är indexets egna kort med brus (en "fångst" av kortet). Varje fråga körs som live-pollen
 * (7 avtryck, k=10) och som skanningen (28 avtryck, k=30) genom båda vägarna; svaren ska vara lika
 * bit för bit. Skriver ut tiderna — det är de som avgör pollens och skanningens serverdel.
 */
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "../src/lib/art-fingerprint";
import { getArtIndex, searchIndexForTest, searchLoadedIndex } from "../src/services/scanner/art-index";
import { prisma } from "../src/lib/db";

async function main() {
  const rounds = Number(process.argv[2] ?? 40);
  const index = await getArtIndex();
  if (!index) throw new Error("inget index");
  const n = index.ids.length;
  console.log(`index: ${n} kort, kärna: ${index.kernel ? "ja" : "NEJ"}`);
  if (!index.kernel) throw new Error("kärnan startade inte");

  let seed = 20261128;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const noisy = (src: Int8Array, amp: number) =>
    Int8Array.from(src, (v) => Math.max(-128, Math.min(127, v + Math.round((rnd() * 2 - 1) * amp))));
  const queryFor = (row: number, amp: number) => ({
    color: noisy(index.data.subarray(row * FINGERPRINT_BYTES, (row + 1) * FINGERPRINT_BYTES), amp),
    struct: noisy(index.struct.subarray(row * STRUCT_BYTES, (row + 1) * STRUCT_BYTES), amp),
  });

  let different = 0;
  let top1Hit = 0;
  const time = { js7: 0, k7: 0, js28: 0, k28: 0 };
  for (let i = 0; i < rounds; i++) {
    const row = Math.floor(rnd() * n);
    for (const [count, k, jsKey, kKey] of [
      [7, 10, "js7", "k7"],
      [28, 30, "js28", "k28"],
    ] as const) {
      const queries = Array.from({ length: count }, (_, v) => ({ query: queryFor(row, 10 + v * 6), k }));
      let t = performance.now();
      // Samma minne, JS-loopen: indexets fält utan kärnan.
      const js = searchIndexForTest(index, queries, "js");
      time[jsKey] += performance.now() - t;
      t = performance.now();
      const kernel = searchLoadedIndex(index, queries);
      time[kKey] += performance.now() - t;
      if (JSON.stringify(js) !== JSON.stringify(kernel)) different++;
      if (count === 7 && kernel[0][0]?.cardId === index.ids[row]) top1Hit++;
    }
  }
  const ms = (v: number) => `${(v / rounds).toFixed(1)} ms`;
  console.log(`avvikande svar: ${different} av ${rounds * 2}`);
  console.log(`(rimlighetskoll: kortet självt överst i ${top1Hit} av ${rounds} brusade frågor)`);
  console.log(`live-poll  (7 avtryck):  JS ${ms(time.js7)}  →  kärnan ${ms(time.k7)}`);
  console.log(`skanning  (28 avtryck):  JS ${ms(time.js28)}  →  kärnan ${ms(time.k28)}`);
  await prisma.$disconnect();
  if (different > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
