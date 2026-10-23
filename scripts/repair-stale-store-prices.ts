/**
 * LAGA FRUSNA BUTIKSPRISER — en offer vars URL står i butikens feed men vars PRIS aldrig
 * skrevs om (2026-10-23).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/repair-stale-store-prices.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/repair-stale-store-prices.ts --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/repair-stale-store-prices.ts --store=Spelexperten
 *
 * VARFÖR: nattens `runScrapeJob` matchade varje annons om på TITELN och hoppade över
 * annonsen när titeln inte gav någon produkt ("Ingen produktmatchning") eller gav en annan
 * än den som redan ägde URL:en. Offern på URL:en — skapad av auto-importen, GTIN-uppslaget
 * eller en bevakad länk — fick därför aldrig sitt pris uppdaterat, medan restock-skanningen
 * bumpade `lastSeenAt`. Spelexpertens 30th UPC Night stod på 2 899 kr mot butikens 3 499,
 * Spelexperten ensam hade 161 sådana hopp av 368 annonser på en natt. Runnern binder nu på
 * URL:en först; det här skriptet tar ikapp det som redan frusit, utan att vänta en natt.
 *
 * Skriver BARA `price` (och `currency`) på en befintlig offer, med samma vakter som
 * runnern: platshållarpris och undre rimlighetsgränsen mot CM ⇒ skrivs inte; okänt pris
 * (null) skriver aldrig över ett känt. Rör aldrig lagerstatus ⇒ inga RestockEvent, inga
 * larm. Billigaste annonsen vinner när flera rader i feeden delar URL (som runnern).
 * Räknar om priscachen efteråt.
 */
import "./load-env";
import { SourceType } from "@prisma/client";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { getAdapter } from "../src/scrapers/runner";
import { isPlausiblePriceFor } from "../src/scrapers/matching";
import { isPlaceholderListingPrice } from "../src/lib/listing-plausibility";
import { isStoreRetailer } from "../src/lib/offer-source";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");
const STORE = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);

async function main() {
  await ensureDbAwake();
  const sources = await prisma.scrapeSource.findMany({
    where: { isActive: true, type: SourceType.SCRAPER, ...(STORE ? { name: STORE } : {}) },
    select: { name: true, type: true },
    orderBy: { name: "asc" },
  });
  let total = 0;
  const touched = new Set<string>();
  for (const source of sources) {
    if (!isStoreRetailer(source.name) || source.name === "Tradera") continue;
    const retailer = await prisma.retailer.findFirst({ where: { name: source.name }, select: { id: true } });
    if (!retailer) continue;

    let products;
    try {
      const adapter = getAdapter(source.type, source.name);
      const result = await adapter.fetchProducts();
      if (result.errors.length) console.log(`  ${source.name}: ${result.errors.length} adapterfel (${result.errors[0]})`);
      products = result.products.flatMap((raw) => {
        if (!adapter.validateResult(raw)) return [];
        const n = adapter.normalizeProduct(raw);
        return [{ url: n.url, price: n.offerPrice ?? n.price, currency: n.currency }];
      });
    } catch (e) {
      console.log(`== ${source.name}: feeden gick inte att hämta (${e instanceof Error ? e.message : e})`);
      continue;
    }
    // Billigaste prissatta annonsen per URL (runnerns "billigaste vinner").
    const feedPrice = new Map<string, { price: number; currency: string }>();
    for (const p of products) {
      if (p.price == null || p.price <= 0) continue;
      const cur = feedPrice.get(p.url);
      if (!cur || p.price < cur.price) feedPrice.set(p.url, { price: p.price, currency: p.currency });
    }

    const offers = await prisma.offer.findMany({
      where: { retailerId: retailer.id, url: { in: [...feedPrice.keys()] } },
      select: { id: true, url: true, price: true, productId: true, product: { select: { title: true, category: true } } },
    });
    const cm = await prisma.offer.findMany({
      where: { productId: { in: offers.map((o) => o.productId) }, retailer: { name: "Cardmarket" }, price: { not: null } },
      select: { productId: true, price: true },
    });
    const cmPrice = new Map(cm.map((o) => [o.productId, o.price!] as const));

    let changed = 0;
    for (const o of offers) {
      const f = feedPrice.get(o.url)!;
      if (o.price === f.price) continue;
      if (isPlaceholderListingPrice(f.price, o.product.category)) continue;
      if (!isPlausiblePriceFor(o.product.category, cmPrice.get(o.productId), f.price, "store")) {
        console.log(`  vakt: ${source.name} "${o.product.title}" ${f.price} öre (CM ${cmPrice.get(o.productId)})`);
        continue;
      }
      changed++;
      touched.add(o.productId);
      console.log(
        `  ${source.name.padEnd(16)} ${o.price != null ? (o.price / 100).toFixed(0) : "–"} → ${(f.price / 100).toFixed(0)} kr  ${o.product.title}`
      );
      if (APPLY) await prisma.offer.update({ where: { id: o.id }, data: { price: f.price, currency: f.currency } });
    }
    total += changed;
    console.log(`== ${source.name}: ${feedPrice.size} prissatta feed-URL:er, ${offers.length} bundna offers, ${changed} fel pris`);
  }
  console.log(`\n${APPLY ? "RÄTTADE" : "SKULLE RÄTTA"} ${total} offers på ${touched.size} produkter.`);
  if (APPLY && total > 0) {
    await recomputeProductPriceCache();
    console.log("Priscachen omräknad.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
