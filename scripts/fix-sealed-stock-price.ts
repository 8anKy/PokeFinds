/**
 * Rättar BEFINTLIGA sealed-CM-offers: pris = ENDAST CM `lowest` (ingen 30d-snitt-
 * fallback), lager = IN_STOCK bara när lowest finns. Tar bort falska "i lager"
 * + uppblåsta vintage-30d-priser (t.ex. Lucario Tin 10 086 kr). Använder cachen
 * (.cache/rapidapi-sealed.json) → ingen API-kvot. Idempotent.
 *
 * Dry run:  npx tsx scripts/fix-sealed-stock-price.ts
 * Skriv:    APPLY=1 npx tsx scripts/fix-sealed-stock-price.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { PrismaClient } from "@prisma/client";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");

async function main() {
  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const cache = JSON.parse(fs.readFileSync(CACHE, "utf-8")) as any[];
  const byId = new Map<number, { low: number | null; avg: number | null }>();
  for (const p of cache) {
    if (p.cardmarket_id != null)
      byId.set(p.cardmarket_id, {
        low: p.prices?.cardmarket?.lowest ?? null,
        avg: p.prices?.cardmarket?.["30d_average"] ?? null,
      });
  }

  const offers = await prisma.offer.findMany({
    where: {
      retailerId: cm.id,
      condition: "SEALED",
      url: { contains: "idProduct=" },
    },
    select: { id: true, price: true, stockStatus: true, url: true },
  });
  console.log(`Sealed-CM-offers: ${offers.length} · APPLY=${APPLY}\n`);

  let inStock = 0, outStock = 0, noPrice = 0, stockFixed = 0, noData = 0, unchanged = 0;
  for (const o of offers) {
    const cmid = parseInt(o.url.match(/idProduct=(\d+)/)![1], 10);
    const d = byId.get(cmid);
    if (!d) { noData++; continue; }
    // I lager = aktuell lowest/From. Ur lager = ingen lowest men 30d-snitt finns.
    const eur = d.low ?? d.avg;
    const newPrice = eur != null ? Math.round(eur * rates.eurToOre) : null;
    const newStock = d.low != null ? "IN_STOCK" : d.avg != null ? "OUT_OF_STOCK" : "UNKNOWN";
    if (o.price === newPrice && o.stockStatus === newStock) { unchanged++; continue; }
    if (d.low != null) inStock++;
    else if (d.avg != null) outStock++;
    else noPrice++;
    if (o.stockStatus !== newStock) stockFixed++;
    if (APPLY) await prisma.offer.update({ where: { id: o.id }, data: { price: newPrice, stockStatus: newStock } });
  }

  console.log(`I lager (From-pris):           ${inStock}`);
  console.log(`Ur lager (30d-snitt-pris):     ${outStock}`);
  console.log(`Utan prisdata (→ pris –):      ${noPrice}`);
  console.log(`Lagerstatus ändrad:            ${stockFixed}`);
  console.log(`Oförändrade:                   ${unchanged} · utan cache-data: ${noData}`);
  if (!APPLY) console.log("\n(dry run — kör APPLY=1 för att skriva)");
}

main().finally(() => prisma.$disconnect());
