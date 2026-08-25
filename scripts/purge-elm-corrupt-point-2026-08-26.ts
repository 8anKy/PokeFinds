/**
 * ENGÅNGSSTÄD: tar bort den korrupta prispunkten för Professor Elm's Training Method
 * (DF 79) som skrevs 2026-08-25.
 *
 * VAD SOM HÄNDE: leverantören svarade `lowest_near_mint: null` och `30d_average: 20.55`
 * för idProduct 277284 — Cardmarkets EGEN sida visar From 0,10 € och 30d-snitt 0,27 €.
 * Guide-raden (som hade dränkt utstickaren i medianen) slogs aldrig upp, eftersom nyckeln
 * togs ur feedens `cardmarket_id` och den var null. Resultat: 310 öre → 22 769 öre på ett
 * dygn, skrivet både till offern och till `PriceSnapshot`.
 *
 * ⛔ RÄTTA KODEN FÖRST. Orsaken är lagad i `cardmarket-refresh.ts` (guide-nyckeln faller
 * tillbaka på vår egen länkade idProduct). Körs det här skriptet utan den fixen skriver
 * nästa dagliga refresh (13:00 UTC) tillbaka exakt samma värde — källan säger fortfarande
 * 20,55 €, och dagvakten kan inte döma saken när dess referens kommer ur samma svar.
 *
 * ⛔ VI GISSAR INGET PRIS. Punkten RADERAS, den skrivs inte om till 310 öre: prishistoriken
 * byggs framåt ur mätningar, och att fylla i ett tal vi räknat ut själva vore att fabricera
 * historik. Offerns pris nollas → produktsidan visar "–" tills nästa refresh sätter det
 * riktiga värdet (~304 öre med guide-raden på plats). "–" läses som "vi vet inte".
 *
 * Torrkörning som default. Skriv med `--apply`.
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-elm-corrupt-point-2026-08-26.ts --apply
 */
import { prisma } from "../src/lib/db";

const SLUG = "professor-elm-s-training-method-ex15-79";
const BAD_DATE = new Date(Date.UTC(2026, 7, 25)); // 2026-08-25, UTC-dygnsnyckel
const BAD_ORE = 22769;
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "🔧 APPLY — skriver till databasen." : "🔍 TORRKÖRNING — inget skrivs. Kör med --apply.");

  const p = await prisma.product.findFirst({
    where: { slug: SLUG },
    select: { id: true, title: true, lowestPriceOre: true },
  });
  if (!p) {
    console.log(`Hittade ingen produkt med slug ${SLUG}.`);
    return;
  }

  const snap = await prisma.priceSnapshot.findFirst({ where: { productId: p.id, date: BAD_DATE } });
  const offer = await prisma.offer.findFirst({
    where: { productId: p.id, retailer: { name: "Cardmarket" } },
    select: { id: true, price: true, stockStatus: true },
  });

  console.log(`\n${p.title}`);
  console.log(`  snapshot 2026-08-25: ${snap ? `${snap.minPrice} öre` : "saknas"}`);
  console.log(`  CM-offer:            ${offer ? `${offer.price} öre (${offer.stockStatus})` : "saknas"}`);

  // ⛔ Rör BARA det kända korrupta värdet. Har något redan rättat punkten är det inte
  // vår sak att radera den — en städare som skjuter brett är farligare än felet.
  if (snap && snap.minPrice !== BAD_ORE) {
    console.log(`\n  Punkten är ${snap.minPrice} öre, inte ${BAD_ORE} — någon annan har redan rört den. Avbryter.`);
    return;
  }

  if (!APPLY) {
    console.log("\nSkulle: radera snapshot-punkten och nolla CM-offerns pris.");
    return;
  }

  if (snap) {
    await prisma.priceSnapshot.delete({ where: { id: snap.id } });
    console.log("  🗑️  Snapshot-punkten borttagen.");
  }
  if (offer && offer.price === BAD_ORE) {
    await prisma.offer.update({ where: { id: offer.id }, data: { price: null } });
    console.log('  ♻️  CM-offerns pris nollat → "–" tills nästa refresh.');
  }
  // Priscachen är materialiserad; utan omräkning ligger 22 769 kvar som "lägsta pris".
  const { recomputeProductPriceCache } = await import("../src/services/products");
  await recomputeProductPriceCache();
  console.log("  ♻️  Priscachen omräknad.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
