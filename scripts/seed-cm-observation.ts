/**
 * Skriver DAGENS Cardmarket-observation för produkter som har en prissatt CM-offer
 * men ingen enda CM-observation — annars kan prisgrafen inte visa Cardmarket alls
 * och faller tillbaka på Tradera/butik.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/seed-cm-observation.ts
 *   ... --apply
 *
 * ⛔ INGEN HISTORIK UPPFINNS. Raden är dagens datum och dagens KÄNDA CM-pris, exakt
 *    det `cardmarket-refresh` skriver 13:00 UTC — skriptet gör bara att grafen stämmer
 *    direkt i stället för efter nästa dygn. Historik byggs FRAMÅT; bakåt fyller vi aldrig.
 *
 * VARFÖR DET BEHÖVS: en nyskapad eller nylänkad produkt får sin CM-OFFER direkt, men
 * observationen skrivs bara av det dagliga jobbet. Under mellantiden visar produktsidan
 * "Latest market price" från den enda källa som HAR en punkt — för
 * "First Partner Illustration Booster Series 1" var det Traderas 607 kr bredvid
 * CM-priset 501,75 kr, vilket läser som att vi spårar fel marknad.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const cm = await prisma.retailer.findUniqueOrThrow({ where: { name: "Cardmarket" } });
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cmSource) throw new Error('ScrapeSource "Cardmarket" saknas — observationen måste bära källan.');

  const products = await prisma.product.findMany({
    where: { offers: { some: { retailerId: cm.id, price: { not: null } } },
             category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, hiddenAt: null },
    select: { id: true, title: true, offers: { where: { retailerId: cm.id }, select: { price: true } } },
  });
  const withObs = new Set((await prisma.priceObservation.findMany({
    where: { productId: { in: products.map((p) => p.id) }, sourceId: cmSource.id },
    select: { productId: true }, distinct: ["productId"],
  })).map((o) => o.productId));

  const missing = products.filter((p) => !withObs.has(p.id) && p.offers[0]?.price != null);
  console.log(`Saknar CM-observation: ${missing.length}\n`);
  for (const p of missing) console.log(`   ${((p.offers[0].price ?? 0) / 100).toFixed(2).padStart(9)} kr  ${p.title.slice(0, 52)}`);
  if (!APPLY) return console.log(`\nTorrkörning — inget skrevs.`);

  await prisma.priceObservation.createMany({
    data: missing.map((p) => ({
      productId: p.id, sourceId: cmSource.id, price: p.offers[0].price!,
      currency: "SEK", condition: "SEALED" as const,
    })),
  });
  console.log(`\nSkrev ${missing.length} observationer.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
