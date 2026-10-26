// Kvartalsmätningen bakom lib/condition-prices.ts: median av CardTraders skickgolv / NM-golv per värdeband.
// Kör: node scripts/with-prod-db.mjs npx tsx scripts/condition-ratio-report.ts
import { prisma } from "@/lib/db";
type F = { ore: number; n: number };
const CONDS = ["MINT", "EXCELLENT", "GOOD", "PLAYED", "POOR"] as const;
const BANDS: [string, number, number][] = [["< 20 kr", 0, 2000], ["20–100 kr", 2000, 10000], ["100–500 kr", 10000, 50000], ["500+ kr", 50000, 1e12]];
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * p)] : NaN; };
async function main() {
  const rows = await prisma.$queryRawUnsafe<{ cp: Record<string, F> }[]>(`select "conditionPrices" as cp from "Product" where "conditionPrices" is not null and "hiddenAt" is null`);
  for (const minDepth of [2, 3]) {
    console.log(`\n=== min annonser per skick: ${minDepth} (NM >= 3) ===`);
    for (const [label, lo, hi] of [["ALLA", 0, 1e12] as [string, number, number], ...BANDS]) {
      const out: string[] = [];
      for (const c of CONDS) {
        const r: number[] = [];
        for (const { cp } of rows) {
          const nm = cp?.NEAR_MINT, x = cp?.[c];
          if (!nm || !x || nm.n < 3 || x.n < minDepth || nm.ore < lo || nm.ore >= hi) continue;
          r.push(x.ore / nm.ore);
        }
        out.push(`${c}: n=${r.length} p25=${(q(r, .25) * 100).toFixed(0)} med=${(q(r, .5) * 100).toFixed(0)} p75=${(q(r, .75) * 100).toFixed(0)}`);
      }
      console.log(label.padEnd(11), out.join(" | "));
    }
  }
  await prisma.$disconnect();
}
main();
