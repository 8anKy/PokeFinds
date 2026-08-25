/**
 * ENGÅNGSSKRIPT: retirera Spelkortsbutiken — butiken har lagt ner sin webbshop.
 *
 * VERIFIERAT 2026-08-25: www.spelkortsbutiken.se republicerades 2026-08-17 på Duda
 * (`SiteType: DUDAONE`) som en ren informationssajt för en öl- och spelpub i Karlstad
 * — menyn är "Våra öl och spel / Evenemang / Boka bord / Kontakta oss", sitemapen har
 * FYRA url:er (/, /blog, /boka-bord, /nyhet-fran-stigbergets) och sidparametern
 * `StorePagesUrls` är base64 för `{}`, dvs INGA butikssidor alls. Det finns alltså
 * ingen markup kvar att skriva om — adaptern kan inte lagas, butiken säljer inget.
 *
 * Hälsokollens larm var KORREKT och fångade nedläggningen inom en vecka: 08-17 gav
 * adaptern 3 produkter (sajten mitt i bytet), 08-24 gav den 0.
 *
 * ⛔ INGEN DENYLIST BEHÖVS. Denylistan finns för URL:er som en LEVANDE feed skulle
 * återskapa (`ensureListingProduct` läser den per annons). Här stängs källan av, så
 * ingen skrapning rör butiken igen och inga herrelösa URL:er kan uppstå. Att lägga in
 * dem hade dessutom varit onödigt brett — se .claude/rules/catalog-curation.md om hur
 * `normUrl` kan neka mer än man tror.
 *
 * Torrkörning som default. Skriv med `--apply`.
 *   node scripts/with-prod-db.mjs npx tsx scripts/retire-spelkortsbutiken.ts --apply
 */
import { prisma } from "../src/lib/db";
import { recomputeProductPriceCache } from "../src/services/products";

const STORE = "Spelkortsbutiken";
const APPLY = process.argv.includes("--apply");

async function main() {
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

  console.log(`\nKälla:    ${source ? `isActive=${source.isActive} config=${JSON.stringify(source.config)}` : "saknas"}`);
  console.log(`Retailer: ${retailer ? `isActive=${retailer.isActive}` : "saknas"}`);
  console.log(`\n${offers.length} offers att ta bort:`);
  for (const o of offers) {
    // Antalet kvarvarande butiker är hela skälet att det här är ofarligt — skriv ut det
    // så en granskare ser att ingen produkt blir utan köpalternativ.
    const others = await prisma.offer.count({
      where: { productId: o.product.id, retailerId: { not: retailer!.id } },
    });
    console.log(`  • ${o.product.title} (/produkter/${o.product.slug})`);
    console.log(`    ${o.url}`);
    console.log(`    pris=${o.price} status=${o.stockStatus} — ${others} andra offers blir kvar`);
  }

  if (!APPLY) {
    console.log("\nTorrkörning klar — inget skrevs.");
    return;
  }

  if (offers.length > 0) {
    const { count } = await prisma.offer.deleteMany({ where: { retailerId: retailer!.id } });
    console.log(`\n🗑️  ${count} offers borttagna.`);
  }

  // isActive=false på BÅDA: källan styr skrapningen och hälsokollen (som bara läser
  // `isActive` + `config.restockWatch`), retailern styr om butiken kan dyka upp i
  // butikslistor och filter. `restockWatch: false` sätts också — så att en framtida
  // återaktivering av källan är ett medvetet beslut i två steg, inte en halkning.
  if (source) {
    const config = { ...((source.config as Record<string, unknown> | null) ?? {}), restockWatch: false };
    await prisma.scrapeSource.update({ where: { id: source.id }, data: { isActive: false, config } });
    console.log("🔕 ScrapeSource: isActive=false, restockWatch=false.");
  }
  if (retailer) {
    await prisma.retailer.update({ where: { id: retailer.id }, data: { isActive: false } });
    console.log("🔕 Retailer: isActive=false.");
  }

  // Priscachen är materialiserad — utan det här behåller de tre produkterna ett
  // "lägsta pris" som räknats med en offer som inte finns längre.
  await recomputeProductPriceCache();
  console.log("♻️  Priscachen omräknad.");
  console.log("\nKlart. Butiksräkningen i hälsokollen går från 43 till 42.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
