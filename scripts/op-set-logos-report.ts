/** Rapport (läser bara): One Piece-setens loggor. `node scripts/with-prod-db.mjs npx tsx scripts/op-set-logos-report.ts` */
import { prisma } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { isRealSetLogo } from "../src/lib/set-logo";

async function main() {
  const rows = await prisma.$queryRaw<{ code: string | null; name: string; logoUrl: string | null }[]>`
    SELECT code, name, "logoUrl" FROM "CardSet" WHERE game::text = 'ONE_PIECE' ORDER BY code NULLS LAST`;
  const bad = rows.filter((r) => !isRealSetLogo(r.logoUrl));
  console.log(`${rows.length} set, ${bad.length} utan godkänd logga`);
  for (const r of bad) console.log(`  ${r.code ?? "–"} ${r.name}: ${r.logoUrl ?? "null"}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => exitJob());
