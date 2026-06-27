/**
 * Pilot för Option C (variant-modellering): delar "Charmander · 151 4/165" i två
 * katalogprodukter — bas-common (RapidAPI From) + GameStop-promo (pokemontcg.io-trend).
 *
 * Den BEFINTLIGA produkten (som redan bär den dyra historiken + V3/GameStop-CM-länken)
 * blir VARIANTEN; en NY produkt skapas för bas-commonen och ärver den rena slug:en.
 * Engångsskript — kör mot prod via DATABASE_URL=$NEON_DATABASE_URL npx tsx scripts/...
 */
import { PrismaClient } from "@prisma/client";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { runVariantRefresh } from "../src/jobs/cardmarket-refresh";
import { recomputeProductPriceCache } from "../src/services/products";

const db = new PrismaClient();

const EXISTING_ID = "cmq97mogy00gbxurqi06mahpp"; // Charmander · 151 4/165
const VARIANT_LABEL = "GameStop Promo (Reverse Holo)";
const COMMON_CM_ID = 733599; // RapidAPI cardmarket_id för bas-commonen
const TRADERA_RETAILER = "cmq9ioa040001dzrqlohtr78h";
const CM_RETAILER = "cmq97mobw00bwxurq1sy5ybgp";

async function main() {
  const existing = await db.product.findUnique({
    where: { id: EXISTING_ID },
    select: { id: true, title: true, slug: true, cardId: true, setId: true, imageUrl: true, variantLabel: true,
      offers: { select: { id: true, retailerId: true } } },
  });
  if (!existing) throw new Error("Hittar inte befintlig produkt");
  if (existing.variantLabel) { console.log("Redan delad — avbryter."); return; }

  const canonicalSlug = existing.slug;
  const baseTitle = existing.title; // "Charmander · 151 4/165"

  // 1) Befintlig produkt → GameStop-varianten (behåller dyr historik + V3-offer).
  await db.product.update({
    where: { id: existing.id },
    data: {
      slug: `${canonicalSlug}-gamestop-promo`,
      title: `${baseTitle} · ${VARIANT_LABEL}`,
      variantLabel: VARIANT_LABEL,
    },
  });

  // 2) Ny bas-common-produkt som ärver den rena slug:en.
  const common = await db.product.create({
    data: {
      title: baseTitle,
      normalizedTitle: existing.title.toLowerCase(),
      slug: canonicalSlug,
      category: "SINGLE_CARD",
      cardId: existing.cardId,
      setId: existing.setId,
      imageUrl: existing.imageUrl,
      variantLabel: null,
    },
  });

  // 3) Flytta Tradera-offern (rå common-annons) till common-produkten.
  const tradera = existing.offers.find((o) => o.retailerId === TRADERA_RETAILER);
  if (tradera) await db.offer.update({ where: { id: tradera.id }, data: { productId: common.id } });

  // 4) Ge commonen en CM-offer (From-pris fylls/uppdateras dagligen av RapidAPI).
  await db.offer.upsert({
    where: { productId_retailerId_condition_language: { productId: common.id, retailerId: CM_RETAILER, condition: "NEAR_MINT", language: "EN" } },
    update: {},
    create: {
      productId: common.id, retailerId: CM_RETAILER, condition: "NEAR_MINT", language: "EN",
      price: 33, currency: "SEK", stockStatus: "IN_STOCK",
      url: cardmarketProductUrl(COMMON_CM_ID, { nearMint: true }),
    },
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  await db.priceSnapshot.upsert({
    where: { productId_date: { productId: common.id, date: today } },
    update: { minPrice: 33, maxPrice: 33, avgPrice: 33 },
    create: { productId: common.id, date: today, minPrice: 33, maxPrice: 33, avgPrice: 33, volume: 1 },
  });

  // 5) Rensa de felaktiga billiga snapshotsen (RapidAPI From efter 18 juni) som
  //    hamnade på varianten — variantgrafen ska vara dyr hela vägen.
  const del = await db.priceSnapshot.deleteMany({
    where: { productId: existing.id, date: { gte: new Date("2026-06-18T00:00:00Z") }, minPrice: { lt: 1000 } },
  });
  console.log(`Raderade ${del.count} felaktiga billiga variant-snapshots.`);

  // 6) Prissätt varianten nu via pokemontcg.io-trend + skriv dagens punkt.
  const n = await runVariantRefresh();
  console.log(`runVariantRefresh prissatte ${n} variant(er).`);

  await recomputeProductPriceCache();
  console.log("Klart. common:", common.slug, "| variant:", `${canonicalSlug}-gamestop-promo`);
}

main().finally(() => db.$disconnect());
