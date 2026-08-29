/**
 * Engångs-omtitling av japanska singlar till EN-formen (utan setkod i titeln):
 *   "Dusclops (JP) · Night Wanderer (SV6a) 19/64" → "Dusclops (JP) · Night Wanderer 19/64"
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/retitle-jp-singles.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/retitle-jp-singles.ts --apply
 *
 * Räknar titeln ur samma funktion som importen (`jpProductTitle`), inga API-anrop.
 */
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { jpProductTitle } from "../src/jobs/jp-singles-refresh";
import { mapPool } from "../src/lib/concurrency";

const APPLY = process.argv.includes("--apply");

async function main() {
  const products = await prisma.product.findMany({
    where: { language: "JP", category: "SINGLE_CARD", card: { tcgExternalId: { startsWith: "tcggo-jp:" } } },
    select: { id: true, title: true, card: { select: { name: true, number: true } }, set: { select: { name: true, totalCards: true } } },
  });
  const changes = products
    .map((p) => {
      const nameEn = p.card!.name.replace(/\s*\(JP\)\s*$/, "");
      const title = jpProductTitle(nameEn, p.set?.name ?? "", p.card!.number, p.set?.totalCards ?? null);
      return { id: p.id, from: p.title, to: title };
    })
    .filter((c) => c.from !== c.to);
  console.log(`${products.length} JP-singlar, ${changes.length} att döpa om.`);
  console.log(changes.slice(0, 5).map((c) => `  ${c.from}\n  → ${c.to}`).join("\n"));
  if (APPLY) {
    await mapPool(changes, 8, async (c) => {
      await prisma.product.update({ where: { id: c.id }, data: { title: c.to, normalizedTitle: normalizeTitle(c.to) } });
    });
    console.log(`SKRIVET: ${changes.length}.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
