/**
 * Skriver dagens historikpunkt för SINGLAR ur det pris vi FAKTISKT publicerar
 * (Cardmarket-offerns pris just nu). Samma definition som grafen redan har:
 * "publicerat headline-värde per dag" — ingen fabrikation, bara en punkt för det
 * värde katalogen visar idag.
 *
 * Finns för att kunna stänga ett dygn utan att bränna RapidAPI-kvot: den dagliga
 * refreshen skriver normalt punkten själv, men efter en rättad omkörning (eller när
 * ett korrupt dygn raderats) behöver dagen fyllas i från de redan korrigerade
 * offers som ligger i databasen.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/snapshot-singles-today.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/snapshot-singles-today.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { mapPool } from "../src/lib/concurrency";
import { utcToday } from "../src/lib/utils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const db = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const today = utcToday();
  console.log(
    `DB: ${db[0].current_database}   dag (UTC): ${today.toISOString().slice(0, 10)}   läge: ${APPLY ? "SKRIVER" : "TORRKÖRNING"}\n`
  );

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const src = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm || !src) throw new Error("Cardmarket-retailer/källa saknas");

  const rows = await prisma.offer.findMany({
    where: { retailerId: cm.id, price: { gt: 0 }, product: { category: "SINGLE_CARD" } },
    select: { productId: true, price: true },
  });
  const existing = new Set(
    (await prisma.priceSnapshot.findMany({ where: { date: today }, select: { productId: true } })).map(
      (s) => s.productId
    )
  );
  const todo = rows.filter((r) => !existing.has(r.productId));
  console.log(`Singlar med CM-pris: ${rows.length}   redan punktade idag: ${rows.length - todo.length}`);
  console.log(`Skrivs: ${todo.length}\n`);

  if (!APPLY || todo.length === 0) {
    if (!APPLY) console.log("Torrkörning — inget skrivet. Kör med --apply.");
    await prisma.$disconnect();
    return;
  }

  await prisma.priceSnapshot.createMany({
    data: todo.map((r) => ({
      productId: r.productId,
      date: today,
      minPrice: r.price!,
      maxPrice: r.price!,
      avgPrice: r.price!,
      volume: 1,
    })),
    skipDuplicates: true,
  });
  // Grafens CM-serie läser PriceObservation direkt → punkta den också.
  await mapPool(chunk(todo, 5000), 2, async (batch) => {
    await prisma.priceObservation.createMany({
      data: batch.map((r) => ({ productId: r.productId, sourceId: src.id, price: r.price!, currency: "SEK" })),
    });
  });
  console.log(`✅ ${todo.length} snapshots och observationer skrivna för ${today.toISOString().slice(0, 10)}.`);
  await prisma.$disconnect();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
