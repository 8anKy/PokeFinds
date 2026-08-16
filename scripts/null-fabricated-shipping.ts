/**
 * Nollar den FABRICERADE fraktavgiften på Cardmarket-offers.
 *
 * Tre skrivare satte en gång en platt påhittad frakt på 4500 öre (45 kr):
 * backfill-marketplace-offers.ts (två ställen) och import-tcgdex-prices.ts.
 * Ingen av dem hade en källa för siffran — Cardmarket-frakt beror på säljare,
 * land och paketstorlek. Skrivarna är borttagna; det här scriptet städar upp
 * raderna de hann skriva. Fältet renderas inte i dag, men "inga fabricerade
 * priser/data" gäller i databasen, inte bara i UI:t.
 *
 * ⛔ AVGRÄNSNING: BARA Cardmarket-offers med shippingPrice EXAKT 4500 rörs.
 * Det finns rader med 4900/5900/0 vars ursprung är OBEVISAT — de kan komma
 * från en riktig källa. Att radera data vi inte förstår är värre än att låta
 * den ligga. Vidga inte urvalet utan att först bevisa var talen kom ifrån.
 *
 * Torrkörning är default. Skriver bara med --apply.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/null-fabricated-shipping.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/null-fabricated-shipping.ts --apply
 */
import { prisma } from "../src/lib/db";
import { formatPrice } from "../src/lib/format";

const APPLY = process.argv.includes("--apply");

/** Det enda fabricerade beloppet vi kan bevisa ursprunget för (öre). */
const FABRICATED_ORE = 4500;

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  const cardmarket = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });

  // Hela fördelningen först, så det syns svart på vitt vad som INTE rörs.
  const distribution = await prisma.offer.groupBy({
    by: ["shippingPrice"],
    where: { shippingPrice: { not: null } },
    _count: { _all: true },
    orderBy: { shippingPrice: "asc" },
  });
  console.log("Fraktbelopp i katalogen (alla butiker, icke-null):");
  for (const row of distribution) {
    const mark = row.shippingPrice === FABRICATED_ORE ? "  ← fabricerat" : "  (rörs inte)";
    console.log(`   ${formatPrice(row.shippingPrice).padStart(10)}  ${String(row._count._all).padStart(5)} offers${mark}`);
  }

  const where = { retailerId: cardmarket.id, shippingPrice: FABRICATED_ORE } as const;

  const before = await prisma.offer.count({ where });
  console.log(
    `\nUrval: Cardmarket-offers med shippingPrice = ${formatPrice(FABRICATED_ORE)} → ${before} rader`
  );

  if (before === 0) {
    console.log("Inget att göra.");
    return;
  }

  // Ett urval att ögna på innan man kör skarpt.
  const sample = await prisma.offer.findMany({
    where,
    take: 10,
    orderBy: { id: "asc" },
    select: { id: true, price: true, product: { select: { title: true } } },
  });
  console.log("\nExempel (max 10):");
  for (const o of sample) {
    console.log(`   ${o.product.title} — pris ${formatPrice(o.price)}`);
  }

  if (!APPLY) {
    console.log(`\nTorrkörning — inget skrevs. ${before} rader skulle nollas (shippingPrice → null).`);
    return;
  }

  const res = await prisma.offer.updateMany({ where, data: { shippingPrice: null } });
  const after = await prisma.offer.count({ where });

  console.log("\n🎉 Klart!");
  console.log(`   Nollade rader:   ${res.count}`);
  console.log(`   Före:            ${before}`);
  console.log(`   Kvar med ${formatPrice(FABRICATED_ORE)}: ${after}`);
  if (after !== 0) console.log("   ⚠️  Kvarvarande rader — någon skriver fortfarande 4500. Leta upp skrivaren.");
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
