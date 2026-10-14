/**
 * Tradera-kontrollen: regeldomen (utan AI, skuggläge) mot LLM-domen på samma par (2026-10-14).
 * Läser bara TraderaMatch-rader som bär en regeldom (`ruleOk` != null). Visar oense par så att
 * ägaren/agenten kan avgöra vem som hade rätt innan reglerna tar över.
 *   node scripts/with-prod-db.mjs npx tsx scripts/tradera-rule-shadow-report.ts [--days 14]
 */
import { prisma } from "../src/lib/db";

async function main() {
  const i = process.argv.indexOf("--days");
  const days = i > 0 ? Number(process.argv[i + 1]) : 14;
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.traderaMatch.findMany({
    where: { ruleOk: { not: null }, checkedAt: { gte: since } },
    select: { itemId: true, ok: true, reason: true, ruleOk: true, ruleReason: true, listingTitle: true, productId: true },
  });
  const titles = new Map(
    (await prisma.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, title: true } }))
      .map((p) => [p.id, p.title])
  );
  const both = rows.filter((r) => r.ok === r.ruleOk).length;
  const ruleOnly = rows.filter((r) => r.ok && !r.ruleOk);
  const aiOnly = rows.filter((r) => !r.ok && r.ruleOk);
  console.log(`[tradera-skugga] ${rows.length} par sedan ${since.toISOString().slice(0, 10)} · överens ${both} (${rows.length ? ((100 * both) / rows.length).toFixed(1) : "–"} %)`);
  console.log(`  bara REGLERNA fäller: ${ruleOnly.length} · bara LLM:en fäller: ${aiOnly.length}`);
  const show = (label: string, list: typeof rows, why: (r: (typeof rows)[number]) => string | null) => {
    if (!list.length) return;
    console.log(`\n${label}`);
    for (const r of list.slice(0, 60)) {
      console.log(`  ${r.itemId} · ${titles.get(r.productId) ?? r.productId} ← "${(r.listingTitle ?? "").slice(0, 70)}"\n      ${(why(r) ?? "").slice(0, 160)}`);
    }
  };
  show("Reglerna fäller, LLM:en godkände:", ruleOnly, (r) => r.ruleReason);
  show("LLM:en fäller, reglerna godkände:", aiOnly, (r) => r.reason);
}
main().finally(() => prisma.$disconnect());
