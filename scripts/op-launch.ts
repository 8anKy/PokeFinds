/**
 * ONE PIECE-LANSERINGEN (steg 1): gör de importerade One Piece-produkterna synliga.
 *
 *   railway run npx tsx scripts/op-launch.ts            (torrkörning: vad som skulle visas)
 *   railway run npx tsx scripts/op-launch.ts --apply    (avdöljer)
 *
 * ⛔ Bara produkter som klarar DAGENS produktregel (`onePieceSealedCategory`) avdöljs — "Treasure
 * Boosters Set Case" skapades av den första importen 2026-11-10 innan grossistregeln vidgades och
 * ska förbli dold. Resten av lanseringen (ingen kod): `FEATURE_ONE_PIECE_PUBLIC=1` i Railway, nyckeln
 * "onepiece" i GitHub-variabeln DISCORD_RESTOCK_CHANNELS, och importens `hidden`-default till false.
 */
import { prisma, ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { onePieceSealedCategory } from "../src/jobs/op-sealed-import";

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureDbAwake();
  const hidden = await prisma.product.findMany({
    where: { game: "ONE_PIECE", hiddenAt: { not: null } },
    select: { id: true, title: true },
  });
  const show = hidden.filter((p) => onePieceSealedCategory(p.title) != null);
  const keep = hidden.filter((p) => onePieceSealedCategory(p.title) == null);
  console.log(`One Piece: ${hidden.length} dolda → ${show.length} avdöljs, ${keep.length} förblir dolda`);
  for (const p of keep) console.log(`  förblir dold: ${p.title}`);
  if (!apply) {
    console.log("Torrkörning — lägg till --apply för att avdölja.");
    return;
  }
  const res = await prisma.product.updateMany({ where: { id: { in: show.map((p) => p.id) } }, data: { hiddenAt: null } });
  console.log(`Avdolda: ${res.count}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
