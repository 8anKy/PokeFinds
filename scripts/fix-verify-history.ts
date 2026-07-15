/**
 * Punktfix för de 9 vintage "verify"-produkter ägaren granskade 2026-07-15.
 * Regeln (ägarens): from > trend > 30-dagssnitt, ALDRIG 1-dagssnitt.
 * Tillägg: när guiden SJÄLV är glitchad (trend/avg orimliga mot vår stabila historik)
 * → använd vår stabila historik-median i stället (Skyridge/Legendary/Sandstorm).
 *
 * Dry-run:  node scripts/with-prod-db.mjs npx tsx scripts/fix-verify-history.ts
 * Skriv:    APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/fix-verify-history.ts
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

const FIXES: { m: string; fromEur?: number; targetOre?: number; del?: string[]; delRange?: [string, string]; note: string }[] = [
  { m: "Shining Legends Elite Trainer Box", fromEur: 299, del: ["2026-07-15"], note: "from 299€ (var trend)" },
  { m: "Phantom Forces Elite Trainer Box", fromEur: 7500, del: ["2026-07-15"], note: "from 7500€ (var trend) — OBS högt, ev fel idProduct" },
  { m: "Unified Minds Elite Trainer Box", fromEur: 500, del: ["2026-07-15"], note: "from 500€ (var trend)" },
  { m: "Skyridge Booster Box", targetOre: 46682000, del: ["2026-07-15"], note: "guide glitchad (trend/avg ~97k€) → stabil historik 466820kr" },
  { m: "Legendary Collection Booster Box", targetOre: 18447300, del: ["2026-07-15"], note: "guide glitchad → stabil historik 184473kr" },
  { m: "Sandstorm Booster Box", targetOre: 6771200, del: ["2026-07-15"], note: "guide glitchad → stabil historik 67712kr" },
  { m: "Team Rocket Returns Booster Box", delRange: ["2026-06-12", "2026-06-19"], note: "pris rätt (19338kr); bara städa 12-19 jun cents" },
  { m: "Rising Rivals Booster Box", fromEur: 29500, del: ["2026-07-15"], note: "from 29500€ (var trend) — OBS mycket högt, ev fel idProduct" },
  { m: "Southern Islands Collection", fromEur: 139.99, del: ["2026-07-15"], note: "from 139.99€ (var trend)" },
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
    const newOre = f.fromEur != null ? Math.round(f.fromEur * rates.eurToOre) : f.targetOre ?? null;
    const toDel = p.priceSnapshots.filter((s) => {
      const d = s.date.toISOString().slice(0, 10);
      if (f.del?.includes(d)) return true;
      if (f.delRange && d >= f.delRange[0] && d <= f.delRange[1]) return true;
      return false;
    });

    console.log(`\n■ ${p.title}\n   ${f.note}`);
    console.log(`   pris    : ${o?.price != null ? (o.price / 100).toFixed(0) + " kr" : "–"}${newOre != null ? ` → ${(newOre / 100).toFixed(0)} kr` : " (oförändrat)"}`);
    console.log(`   raderar : ${toDel.length} punkt(er): ${toDel.map((s) => s.date.toISOString().slice(0, 10) + "=" + (s.avgPrice / 100).toFixed(0) + "kr").join(", ")}`);

    if (APPLY) {
      if (o && newOre != null) await prisma.offer.update({ where: { id: o.id }, data: { price: newOre, stockStatus: "IN_STOCK", lastSeenAt: new Date() } });
      if (toDel.length) await prisma.priceSnapshot.deleteMany({ where: { id: { in: toDel.map((s) => s.id) } } });
      changed++;
    }
  }

  if (APPLY) { await recomputeProductPriceCache(); console.log(`\n✅ Fixade ${changed} + recompute. (Systemfix behövs annars återinförs vid nästa refresh.)`); }
  else console.log(`\nDry-run. APPLY=1 för att skriva.`);
}

main().finally(() => prisma.$disconnect());
