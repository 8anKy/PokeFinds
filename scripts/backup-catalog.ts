/**
 * Punkt-i-tiden-säkerhetskopia av de tabeller katalogverktygen SKRIVER i.
 * Git kan inte ångra en DB-skrivning — det här kan.
 *
 * Täcker exakt sprängradien: Product + Offer (merge/radera/peka-om) och PriceSnapshot
 * (det purge-corrupt-snapshots skulle radera). Skriver ren JSON till en fil.
 *
 * Kör:   node scripts/with-prod-db.mjs npx tsx scripts/backup-catalog.ts [utfil]
 * Läs tillbaka: se scripts/restore-catalog.ts (skrivs vid behov — formatet är rakt av
 *               prisma.<model>.createMany-kompatibelt).
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
const prisma = new PrismaClient();
const OUT = process.argv[2] ?? `backup-catalog-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;

(async () => {
  const [products, offers, snapshots] = await Promise.all([
    prisma.product.findMany(),
    prisma.offer.findMany(),
    prisma.priceSnapshot.findMany(),
  ]);
  const payload = {
    takenAt: new Date().toISOString(),
    database: "neondb (prod)",
    counts: { products: products.length, offers: offers.length, priceSnapshots: snapshots.length },
    products, offers, priceSnapshots: snapshots,
  };
  writeFileSync(OUT, JSON.stringify(payload));
  const mb = (Buffer.byteLength(JSON.stringify(payload)) / 1e6).toFixed(1);
  console.log(`Säkerhetskopia: ${OUT}  (${mb} MB)`);
  console.log(`  Product        ${products.length}`);
  console.log(`  Offer          ${offers.length}`);
  console.log(`  PriceSnapshot  ${snapshots.length}`);
})().finally(() => prisma.$disconnect());
