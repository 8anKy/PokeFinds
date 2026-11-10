/** Rapport (läser bara): One Piece-setens grupp på /sets. `node scripts/with-prod-db.mjs npx tsx scripts/op-set-groups-report.ts` */
import { prisma } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { onePieceGroup } from "../src/lib/set-era";

async function main() {
  const rows = await prisma.$queryRaw<{ name: string; code: string | null; n: number }[]>`
    SELECT s.name, s.code, COUNT(p.id)::int AS n FROM "CardSet" s
      LEFT JOIN "Product" p ON p."setId" = s.id AND p."hiddenAt" IS NULL
     WHERE s.game::text = 'ONE_PIECE' GROUP BY s.id ORDER BY s.code NULLS LAST, s.name`;
  const by = new Map<string, string[]>();
  for (const r of rows) {
    if (r.n === 0) continue;
    const g = onePieceGroup(r.code, r.name);
    (by.get(g) ?? by.set(g, []).get(g)!).push(`${r.code ?? "–"} ${r.name}`);
  }
  for (const [g, l] of by) console.log(`\n${g} (${l.length}):\n  ${l.join("\n  ")}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => exitJob());
