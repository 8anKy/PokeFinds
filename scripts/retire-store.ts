/**
 * Retirera en butik ur bevakningen (ägarbeslut) — generaliserad ur
 * retire-spelkortsbutiken.ts / retire-leksaksaffaren-watch.ts.
 *
 * Vad som händer vid --apply:
 *   • Butikens offers RADERAS (länkarna försvinner från alla produktsidor) och
 *     priscachen räknas om, så inget "lägsta pris" vilar på en borttagen offer.
 *   • ScrapeSource: isActive=false + config.restockWatch=false ⇒ nattkedjan,
 *     hälsokollen och ruttexporten (Discord-lanen) slutar röra butiken. Lanen läser
 *     källistan ur routes.json som scrape-all skriver om varje natt — fram till dess
 *     kan den fortfarande posta om butiken.
 *   • Retailer: isActive=false ⇒ borta ur butikslistor och filter.
 *   • WatchedListing-rader för butiken: isActive=false (raderas inte — ångerbart).
 *   • Produkter som BARA den här butiken sålde: hiddenAt (dolda, inte raderade).
 *
 * ⛔ INGEN DENYLIST: källan stängs av, så ingen feed återskapar produkterna.
 * ⛔ StoreListing (URL→produkt-memot) och RestockEvent lämnas — de är historik och
 *    syns inte för användare.
 *
 * Torrkörning som default:
 *   node scripts/with-prod-db.mjs npx tsx scripts/retire-store.ts --store Blindbox
 *   node scripts/with-prod-db.mjs npx tsx scripts/retire-store.ts --store Blindbox --apply
 */
import { prisma } from "../src/lib/db";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");
const storeIdx = process.argv.indexOf("--store");
const STORE = storeIdx >= 0 ? process.argv[storeIdx + 1] : undefined;

async function main() {
  if (!STORE) {
    console.error("Ange butik: --store <Retailer.name>");
    process.exitCode = 1;
    return;
  }
  console.log(APPLY ? "🔧 APPLY — skriver till databasen." : "🔍 TORRKÖRNING — inget skrivs. Kör med --apply.");

  const source = await prisma.scrapeSource.findFirst({ where: { name: STORE } });
  const retailer = await prisma.retailer.findFirst({ where: { name: STORE } });

  if (!source && !retailer) {
    console.log(`Ingen källa och ingen retailer heter "${STORE}" — redan retirerad?`);
    return;
  }

  const offers = retailer
    ? await prisma.offer.findMany({
        where: { retailerId: retailer.id },
        select: {
          id: true,
          url: true,
          price: true,
          stockStatus: true,
          product: { select: { id: true, title: true, slug: true } },
        },
      })
    : [];
  const watched = retailer
    ? await prisma.watchedListing.count({ where: { retailerId: retailer.id, isActive: true } })
    : 0;

  console.log(`\nKälla:    ${source ? `isActive=${source.isActive} config=${JSON.stringify(source.config)}` : "saknas"}`);
  console.log(`Retailer: ${retailer ? `isActive=${retailer.isActive}` : "saknas"}`);
  console.log(`Bevakade länkar (aktiva): ${watched}`);
  console.log(`\n${offers.length} offers att ta bort:`);

  // Produkter som blir HELT utan offers är det enda som förtjänar en granskares öga.
  const orphans: string[] = [];
  for (const o of offers) {
    const others = await prisma.offer.count({
      where: { productId: o.product.id, retailerId: { not: retailer!.id } },
    });
    if (others === 0) orphans.push(o.product.id);
    console.log(`  • ${o.product.title} (/produkter/${o.product.slug}) pris=${o.price} status=${o.stockStatus} — ${others} andra offers kvar`);
  }
  // En produkt som BARA den här butiken sålde är oftast en auto-importerad butiksspecifik
  // rad (B-grade, bundle) — den DÖLJS (`hiddenAt`, normalvägen — aldrig radering, då
  // återskapar en levande feed den). Produkter med andra offers rörs inte.
  console.log(`\n${orphans.length} produkter blir utan offer och döljs (hiddenAt).`);

  if (!APPLY) {
    console.log("\nTorrkörning klar — inget skrevs.");
    return;
  }

  if (offers.length > 0) {
    const { count } = await prisma.offer.deleteMany({ where: { retailerId: retailer!.id } });
    console.log(`\n🗑️  ${count} offers borttagna.`);
  }
  if (source) {
    const config = { ...((source.config as Record<string, unknown> | null) ?? {}), restockWatch: false };
    await prisma.scrapeSource.update({ where: { id: source.id }, data: { isActive: false, config } });
    console.log("🔕 ScrapeSource: isActive=false, restockWatch=false.");
  }
  if (retailer) {
    await prisma.retailer.update({ where: { id: retailer.id }, data: { isActive: false } });
    const { count } = await prisma.watchedListing.updateMany({
      where: { retailerId: retailer.id, isActive: true },
      data: { isActive: false },
    });
    console.log(`🔕 Retailer: isActive=false. ${count} bevakade länkar avaktiverade.`);
  }

  if (orphans.length > 0) {
    const { count } = await prisma.product.updateMany({
      where: { id: { in: orphans }, hiddenAt: null },
      data: { hiddenAt: new Date() },
    });
    console.log(`🙈 ${count} produkter dolda.`);
  }

  await recomputeProductPriceCache();
  console.log("♻️  Priscachen omräknad.");
  console.log("\nKlart. Kör workflowen restock-routes-export (eller vänta på nattens scrape-all) så Discord-lanen tappar butiken.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
