/**
 * Punktfix för de 5 "spared" sealed-produkter ägaren granskade 2026-07-15: CM-guiden
 * serverade tillfälligt 1-dagssnitt/trend/noll-glitchar som blev historikpunkter. Vi
 * raderar glitch-punkterna och sätter aktuellt pris till rätt bas (from där sådan finns,
 * annars 30-dagssnitt / senaste stabila värde).
 *
 * OBS: rotorsaken är systemisk — dagvakten fångar inte CM-guidens glitch-drop (97000→1105).
 * Detta är en punktstädning; systemfix = guard i cardmarket-refresh (separat).
 *
 * Dry-run:  node scripts/with-prod-db.mjs npx tsx scripts/fix-spared-history.ts
 * Skriv:    APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/fix-spared-history.ts
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

// targetEur/targetOre = nytt aktuellt pris (null = rör inte). del = glitch-datum att radera.
const FIXES: { m: string; targetEur?: number; targetOre?: number; del: string[]; note: string }[] = [
  { m: "Neo Discovery Booster Box", targetEur: 8800, del: ["2024-12-30", "2026-06-12", "2026-06-13", "2026-07-15"], note: "30-dagssnitt 8800€ (din avläsning); 1-dagssnitt-glitch bort" },
  { m: "Emerald Booster Box", targetOre: 331200, del: ["2024-12-30", "2026-06-12", "2026-06-13", "2026-07-15"], note: "ingen from; senaste stabila 3312kr (guide-avg 69.95€ osäker)" },
  { m: "Team Up Booster Box", targetEur: 1799.99, del: ["2026-07-15"], note: "aktuellt → from 1799.99€ (var trend)" },
  { m: "Burning Shadows Booster Pack", del: ["2024-12-30", "2026-06-12", "2026-06-13"], note: "pris rätt (265kr); bara städa 12-13 jun" },
  { m: "Triple Whammy Tins: Darkrai Tin", targetEur: 100, del: ["2026-07-15"], note: "aktuellt → from 100€ (var trend)" },
];

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs.\n");
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  const rates = await getRatesOre();
  let changed = 0;

  for (const f of FIXES) {
    const p = await prisma.product.findFirst({
      where: { title: { contains: f.m } },
      select: { id: true, title: true,
        offers: { where: { retailerId: cm!.id }, select: { id: true, price: true } },
        priceSnapshots: { select: { id: true, date: true, avgPrice: true } } },
    });
    if (!p) { console.log(`❓ SAKNAS: ${f.m}`); continue; }
    const o = p.offers[0];
    const newOre = f.targetEur != null ? Math.round(f.targetEur * rates.eurToOre) : f.targetOre ?? null;
    const toDel = p.priceSnapshots.filter((s) => f.del.includes(s.date.toISOString().slice(0, 10)));

    console.log(`\n■ ${p.title}\n   ${f.note}`);
    console.log(`   pris     : ${o?.price != null ? (o.price / 100).toFixed(0) + " kr" : "–"}${newOre != null ? ` → ${(newOre / 100).toFixed(0)} kr` : " (oförändrat)"}`);
    console.log(`   raderar  : ${toDel.length} glitch-punkt(er): ${toDel.map((s) => s.date.toISOString().slice(0, 10) + "=" + (s.avgPrice / 100).toFixed(0) + "kr").join(", ")}`);

    if (APPLY) {
      if (o && newOre != null) await prisma.offer.update({ where: { id: o.id }, data: { price: newOre, stockStatus: "IN_STOCK", lastSeenAt: new Date() } });
      if (toDel.length) await prisma.priceSnapshot.deleteMany({ where: { id: { in: toDel.map((s) => s.id) } } });
      changed++;
    }
  }

  if (APPLY) {
    await recomputeProductPriceCache();
    console.log(`\n✅ Fixade ${changed} + recompute. OBS: nästa cardmarket-refresh kan återintroducera glitchen tills systemfix (dagvakt-guard).`);
  } else {
    console.log(`\nDry-run. APPLY=1 för att skriva.`);
  }
}

main().finally(() => prisma.$disconnect());
