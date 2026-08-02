/**
 * Hjälpskript: hur SKRIVER CardTrader de set vi inte lyckas mappa på namn?
 * Ren utskrift, inga skrivningar. Underlag för mappningstabellen i
 * scripts/cardtrader-reverse-audit.ts.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ctExpansions } from "../src/lib/cardtrader";

const prisma = new PrismaClient();

function nameKey(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
/** Grov likhet: hur många av våra ord finns i deras namn? */
function overlap(a: string, b: string): number {
  const aw = new Set(nameKey(a).split(" ").filter((w) => w.length > 2));
  const bw = new Set(nameKey(b).split(" ").filter((w) => w.length > 2));
  if (!aw.size) return 0;
  let hit = 0;
  for (const w of aw) if (bw.has(w)) hit++;
  return hit / aw.size;
}

async function main() {
  const [sets, exps] = await Promise.all([
    prisma.cardSet.findMany({
      select: { name: true, series: true, releaseDate: true, _count: { select: { cards: true } } },
      orderBy: { releaseDate: "desc" },
    }),
    ctExpansions(),
  ]);
  const withCards = sets.filter((s) => s._count.cards > 0);
  const expKeys = new Set(exps.map((e) => nameKey(e.name)));
  const unmapped = withCards.filter((s) => !expKeys.has(nameKey(s.name)));

  console.log(`Omappade: ${unmapped.length}\n`);
  for (const s of unmapped.sort((a, b) => b._count.cards - a._count.cards)) {
    const cands = exps
      .map((e) => ({ e, score: overlap(s.name, e.name) }))
      .filter((c) => c.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    console.log(`\n${s.name}  (${s._count.cards} kort, ${s.series})`);
    for (const c of cands) console.log(`    ${c.score.toFixed(2)}  [${c.e.id}] ${c.e.name}`);
    if (!cands.length) console.log("    (ingen kandidat ≥0.5)");
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
