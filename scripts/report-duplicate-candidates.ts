/**
 * MISSTÄNKTA DUBBLETTER som länkar, för ägarens granskning. Rapport, inga skrivningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/report-duplicate-candidates.ts
 *
 * Urvalet är produkter UTAN Cardmarket-länk (nästan alltid butiksformulerade stubbar)
 * plus deras bästa kandidat i katalogen. ⛔ Förslagen är MISSTANKAR, inte domar —
 * matcharen avstår med flit i just det här bandet, och flera par är olika varor som
 * bara liknar varandra. Ägaren avgör.
 */
import { PrismaClient } from "@prisma/client";
import { nearestCatalogCandidate, loadMatchIndex, scoreSimilarity } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();
const BASE = "https://foilio.se/produkter";

async function main() {
  const all = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, hiddenAt: null },
    select: { id: true, title: true, slug: true, language: true, category: true, normalizedTitle: true,
              lowestPriceOre: true,
              offers: { select: { retailer: { select: { name: true } } } },
              _count: { select: { priceSnapshots: true } } },
  });
  const bySlug = new Map(all.map((p) => [p.id, p]));
  const noCm = all.filter((p) => !p.offers.some((o) => o.retailer.name === "Cardmarket"));
  const index = await loadMatchIndex();
  // ⛔ `nearestCatalogCandidate` har INGEN self-exclusion — produkten matchar sig själv
  //    på 1,00 och blir alltid "bästa kandidat". Första versionen av rapporten sa därför
  //    "INGEN KANDIDAT" om precis allt. Indexet filtreras per produkt i stället.

  console.log(`Produkter utan CM-länk: ${noCm.length}\n`);
  let n = 0;
  for (const p of noCm) {
    const cand = nearestCatalogCandidate(
      normalizeTitle(p.title), p.title, index.filter((c) => c.id !== p.id), 0.55
    );
    const target = cand ? bySlug.get(cand.id) : null;
    if (!target || target.id === p.id) {
      console.log(`— INGEN KANDIDAT  [${p.language}] ${p.title}\n   ${BASE}/${p.slug}\n`);
      continue;
    }
    n++;
    const score = scoreSimilarity(normalizeTitle(p.title), target.normalizedTitle);
    console.log(
      `${String(n).padStart(2)}. ${(score * 100).toFixed(0)}%  [${p.language}] ${p.category}\n` +
      `    FRÅN  ${p.title}\n` +
      `          ${BASE}/${p.slug}   (offers=${p.offers.length}, snapshots=${p._count.priceSnapshots})\n` +
      `    TILL  ${target.title}\n` +
      `          ${BASE}/${target.slug}   (offers=${target.offers.length}, snapshots=${target._count.priceSnapshots})\n`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
