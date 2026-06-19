/**
 * Engångsstädning: tar bort butiks-/marknadsplats-offers vars pris är ORIMLIGT
 * mot produktens Cardmarket-pris (felmatchade produktlänkar, t.ex. en 99 kr
 * samlarpärm fäst på en 3158 kr UPC). Använder samma vakt som skrapjobben
 * (isPlausibleListingPrice) som sanning, så städningen = framtida regeln.
 *
 * Kör mot PROD som standard. Dry-run default; APPLY=1 raderar.
 *   npx tsx scripts/clean-mismatched-offers.ts            # dry-run mot prod
 *   APPLY=1 npx tsx scripts/clean-mismatched-offers.ts    # radera + recompute
 *   TARGET=local APPLY=1 npx tsx scripts/clean-mismatched-offers.ts
 */
import * as fs from "fs"; import * as path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
// Peka @/lib/db mot prod INNAN den importeras (den läser DATABASE_URL vid import).
if (process.env.TARGET !== "local" && process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}
import { prisma } from "../src/lib/db";
import { isPlausibleListingPrice } from "../src/scrapers/matching";
import { recomputeProductPriceCache } from "../src/services/products";
import { mapPool } from "../src/lib/concurrency";

const APPLY = process.env.APPLY === "1";

async function main() {
  const db = (await prisma.$queryRawUnsafe<{ d: string }[]>("select current_database() as d"))[0].d;
  console.log(`DB=${db} · APPLY=${APPLY}\n`);

  // Brett kandidatnät: butiks-/marknadsplats-offers med ett CM-referenspris vars
  // pris ligger långt under/över CM (superset av möjliga fel). isPlausibleListingPrice
  // bekräftar sedan varje (hanterar singel-nyanser) innan radering.
  const candidates = await prisma.$queryRawUnsafe<{ id: string; productId: string; price: number; title: string; retailer: string }[]>(`
    SELECT o.id, o."productId", o.price, p.title, r.name retailer
    FROM "Offer" o
    JOIN "Product" p ON p.id = o."productId"
    JOIN "Retailer" r ON r.id = o."retailerId"
    JOIN LATERAL (
      SELECT price FROM "Offer" o2 JOIN "Retailer" r2 ON r2.id=o2."retailerId"
      WHERE o2."productId"=o."productId" AND r2.name='Cardmarket' AND o2.price>0 LIMIT 1
    ) cm ON true
    WHERE r.name NOT IN ('Cardmarket','Tradera','Pokémon TCG API','TCGdex API','Mock-datakälla')
      AND o.price > 0
      AND (o.price < cm.price * 0.4 OR o.price > cm.price * 2.5)
  `);
  console.log(`Kandidater (extremt pris vs CM): ${candidates.length}`);

  const toDelete: typeof candidates = [];
  await mapPool(candidates, 8, async (c) => {
    if (!(await isPlausibleListingPrice(c.productId, c.price))) toDelete.push(c);
  });
  console.log(`Bekräftat orimliga (raderas): ${toDelete.length}\n`);
  for (const c of toDelete) console.log(`  ${c.retailer} | ${c.price / 100}kr | ${c.title}`);

  if (APPLY && toDelete.length) {
    await prisma.offer.deleteMany({ where: { id: { in: toDelete.map((c) => c.id) } } });
    await recomputeProductPriceCache();
    console.log(`\n✅ Raderade ${toDelete.length} offers och räknade om priscachen.`);
  } else if (APPLY) {
    await recomputeProductPriceCache();
    console.log(`\n✅ Inga att radera. Räknade om priscachen ändå.`);
  } else {
    console.log(`\n(dry run — kör APPLY=1 för att radera + recompute)`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
