import { prisma } from "../src/lib/db";
import { listUserAchievements, loadUserStats, buildAchievementProgress } from "../src/services/achievements";
async function main() {
  const top = await prisma.collectionItem.groupBy({ by: ["userId"], _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 1 });
  const userId = top[0].userId;
  const [earned, stats] = await Promise.all([listUserAchievements(userId), loadUserStats(userId)]);
  console.log("stats:", JSON.stringify(stats));
  const rows = buildAchievementProgress(earned, stats);
  console.log(`\n${rows.length} märken, ${rows.reduce((n, r) => n + r.earnedTier, 0)} av ${rows.reduce((n, r) => n + r.tierCount, 0)} nivåer:`);
  for (const r of rows)
    console.log(`  ${r.done ? "OK " : r.earnedTier > 0 ? "..." : "   "} ${r.key.padEnd(22)} nivå ${r.earnedTier}/${r.tierCount}  ${r.current}/${r.threshold}  ${r.percent ?? "-"}%`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
