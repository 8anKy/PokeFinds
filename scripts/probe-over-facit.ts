import { prisma } from "../src/lib/db";
const IDS = ["sve", "svp", "sm11", "sm10", "smp", "xy7"];
async function main() {
  for (const ext of IDS) {
    const set = await prisma.cardSet.findUnique({ where: { externalId: ext }, select: { id: true, name: true } });
    if (!set) continue;
    const cards = await prisma.card.findMany({
      where: { setId: set.id },
      select: { number: true, name: true, tcgExternalId: true, cardmarketId: true, language: true },
      orderBy: { numberSortKey: "asc" },
    });
    const byNum = new Map<string, typeof cards>();
    for (const c of cards) {
      const k = c.number;
      if (!byNum.has(k)) byNum.set(k, [] as never);
      byNum.get(k)!.push(c);
    }
    const dupes = [...byNum.entries()].filter(([, v]) => v.length > 1);
    const noExt = cards.filter((c) => !c.tcgExternalId);
    console.log(`\n### ${ext} ${set.name}: ${cards.length} kort, ${byNum.size} unika nummer, ${dupes.length} dubblettnummer, ${noExt.length} utan tcgExternalId`);
    for (const [num, v] of dupes.slice(0, 12))
      console.log(`   #${num}: ` + v.map((c) => `${c.name}[${c.language}|${c.tcgExternalId ?? "cm:" + c.cardmarketId}]`).join(" | "));
    if (ext === "sve") for (const c of cards) console.log(`   ${c.number} ${c.name} ${c.tcgExternalId ?? "cm:" + c.cardmarketId} ${c.language}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
