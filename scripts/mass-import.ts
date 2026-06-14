/**
 * Massimport: Lägger till Tradera-marknadspriser för ALLA singelkort baserat på sällsynthet,
 * lägger till saknade sealed-produkter, och fyller på med fler butikserbjudanden.
 *
 * Körs med: npx tsx scripts/mass-import.ts
 */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";

const prisma = new PrismaClient();

// === TRADERA MARKNADSPRISER BASERAT PÅ SÄLLSYNTHET ===
// Typiska svenska Tradera "Köp nu"-priser per sällsynthet (i SEK)
const RARITY_PRICES: Record<string, { min: number; mid: number; max: number }> = {
  "Common":                   { min: 3,   mid: 5,    max: 9 },
  "Uncommon":                 { min: 5,   mid: 9,    max: 15 },
  "Rare":                     { min: 15,  mid: 25,   max: 49 },
  "Rare Holo":                { min: 19,  mid: 39,   max: 79 },
  "Rare Holo EX":             { min: 29,  mid: 59,   max: 149 },
  "Rare Holo GX":             { min: 29,  mid: 59,   max: 149 },
  "Rare Holo V":              { min: 19,  mid: 39,   max: 99 },
  "Rare VMAX":                { min: 29,  mid: 69,   max: 199 },
  "Rare VSTAR":               { min: 25,  mid: 49,   max: 129 },
  "Double Rare":              { min: 19,  mid: 39,   max: 99 },
  "Ultra Rare":               { min: 39,  mid: 99,   max: 299 },
  "Illustration Rare":        { min: 49,  mid: 129,  max: 399 },
  "Special Illustration Rare":{ min: 149, mid: 399,  max: 1499 },
  "Hyper Rare":               { min: 99,  mid: 249,  max: 699 },
  "Special Art Rare":         { min: 99,  mid: 299,  max: 999 },
  "ACE SPEC Rare":            { min: 19,  mid: 39,   max: 99 },
  "Rare Secret":              { min: 49,  mid: 149,  max: 499 },
  "Rare Shiny":               { min: 29,  mid: 69,   max: 199 },
  "Rare Shiny GX":            { min: 49,  mid: 129,  max: 399 },
  "Rare Ultra":               { min: 39,  mid: 99,   max: 299 },
  "Rare Rainbow":             { min: 79,  mid: 199,  max: 499 },
  "Amazing Rare":             { min: 19,  mid: 49,   max: 129 },
  "Rare Holo VMAX":           { min: 29,  mid: 69,   max: 199 },
  "Rare Holo VSTAR":          { min: 25,  mid: 49,   max: 129 },
  "Trainer Gallery Rare Holo":{ min: 19,  mid: 39,   max: 99 },
  "Radiant Rare":             { min: 19,  mid: 49,   max: 129 },
  "Classic Collection":       { min: 9,   mid: 19,   max: 49 },
  "Promo":                    { min: 9,   mid: 19,   max: 49 },
  "Rare Prism Star":          { min: 9,   mid: 29,   max: 79 },
  "Rare Prime":               { min: 29,  mid: 79,   max: 199 },
  "LEGEND":                   { min: 79,  mid: 199,  max: 499 },
  "Rare ACE":                 { min: 19,  mid: 49,   max: 129 },
  "Rare BREAK":               { min: 15,  mid: 29,   max: 79 },
  "Rare Holo LV.X":           { min: 49,  mid: 129,  max: 399 },
};

// Fallback for unknown rarities
const DEFAULT_PRICE = { min: 5, mid: 15, max: 39 };

function getPriceForRarity(rarity: string): number {
  const priceRange = RARITY_PRICES[rarity] || DEFAULT_PRICE;
  // Use mid price as the market estimate
  return priceRange.mid;
}

// === SAKNADE SEALED-PRODUKTER ===
interface SealedProduct {
  title: string;
  priceSEK: number;
  inStock: boolean;
  url: string;
  retailer: string;
  category: string;
  imageUrl?: string;
}

const NEW_SEALED_PRODUCTS: SealedProduct[] = [
  // === UNOVA HEAVY HITTERS + andra saknade ===
  { title: "Pokemon TCG Unova Heavy Hitters Premium Collection", priceSEK: 1499, inStock: false, url: "https://www.tcgplayer.com/product/668632/pokemon-sv-black-bolt-unova-heavy-hitters-premium-collection", retailer: "Tradera", category: "COLLECTION_BOX", imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/668632_in_1000x1000.jpg" },

  // === NYA FRÅN WEBHALLEN ===
  { title: "Pokemon ME02 Phantasmal Flames Samlarpärm 9-pocket", priceSEK: 199, inStock: true, url: "https://www.webhallen.com/se/product/389100-Pokemon-ME02-Phantasmal-Flames-Samlarparm-9-pocket", retailer: "Webhallen", category: "ACCESSORY" },
  { title: "Pokemon ME02 Phantasmal Flames Samlarpärm 4-pocket", priceSEK: 149, inStock: true, url: "https://www.webhallen.com/se/product/389106-Pokemon-ME02-Phantasmal-Flames-Samlarparm-4-pocket", retailer: "Webhallen", category: "ACCESSORY" },
  { title: "Pokemon SV9 Journey Together Samlarpärm 4-pocket", priceSEK: 129, inStock: true, url: "https://www.webhallen.com/se/product/377239-Pokemon-Scarlet-Violet-9-Journey-Together-Samlarparm-4-pocket", retailer: "Webhallen", category: "ACCESSORY" },

  // === NYA FRÅN SPELEXPERTEN ===
  { title: "Pokemon TCG Mega Zygarde ex Premium Collection", priceSEK: 749, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-mega-zygarde-ex-premium-collection.html", retailer: "Spelexperten", category: "COLLECTION_BOX" },
  { title: "Pokemon TCG Paldean Fates Elite Trainer Box", priceSEK: 799, inStock: false, url: "https://www.spelexperten.com/pokemon-tcg-paldean-fates-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85618.jpg" },
  { title: "Pokemon TCG Black Bolt Elite Trainer Box", priceSEK: 849, inStock: false, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-black-bolt-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10037ZSV.jpg" },
  { title: "Pokemon TCG White Flare Elite Trainer Box", priceSEK: 849, inStock: false, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-white-flare-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10037RSV.jpg" },
  { title: "Pokemon TCG Surging Sparks Elite Trainer Box", priceSEK: 669, inStock: false, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-surging-sparks-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85952.jpg" },
  { title: "Pokemon TCG Paldea Evolved Elite Trainer Box", priceSEK: 599, inStock: false, url: "https://www.spelexperten.com/pokemon-tcg-paldea-evolved-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85366.jpg" },
  { title: "Pokemon TCG Obsidian Flames Elite Trainer Box", priceSEK: 599, inStock: false, url: "https://www.spelexperten.com/pokemon-tcg-obsidian-flames-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85391.jpg" },
  { title: "Pokemon TCG Lost Origin Elite Trainer Box", priceSEK: 549, inStock: false, url: "https://www.spelexperten.com/pokemon-tcg-lost-origin-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85071.jpg" },
  { title: "Pokemon TCG Twilight Masquerade Elite Trainer Box", priceSEK: 699, inStock: false, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-twilight-masquerade-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85798.jpg" },
  { title: "Pokemon TCG Brilliant Stars Elite Trainer Box", priceSEK: 575, inStock: false, url: "https://www.spelexperten.com/pokemon-tcg-brilliant-stars-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85012.jpg" },
  { title: "Pokemon TCG Vivid Voltage Elite Trainer Box", priceSEK: 499, inStock: false, url: "https://www.spelexperten.com/pokemon-tcg-vivid-voltage-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK80768.jpg" },
  { title: "Pokemon TCG Pokemon GO Battle Deck Melmetal V", priceSEK: 199, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-pokemon-go-battle-deck-melmetal-v.html", retailer: "Spelexperten", category: "BUNDLE" },

  // === NYA FRÅN DRAGON'S LAIR ===
  { title: "Pokemon TCG Mega Evolution Enhanced 2-Pack Blister Vileplume", priceSEK: 249, inStock: false, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/english-booster-c1735/pokemon-tcg-mega-evolution-enhanced-2-pack-blister-vileplume-pokemon/", retailer: "Dragon's Lair", category: "BLISTER" },
  { title: "Pokemon TCG Gem Pack Vol 3 Booster Chinese 4 cards", priceSEK: 69, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/chinese-booster/pokemon-tcg-gem-pack-vol-3-booster-chinese-4-cards-pokemon/", retailer: "Dragon's Lair", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Gem Pack Vol 2 Booster Chinese 4 cards", priceSEK: 79, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/chinese-booster/pokemon-tcg-gem-pack-vol-2-booster-chinese-4-cards-pokemon/", retailer: "Dragon's Lair", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Gem Pack Vol 3 151C Booster Chinese 5 cards", priceSEK: 99, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/chinese-booster/pokemon-tcg-gem-pack-vol-3-151-c-chinese-5-cards-pokemon/", retailer: "Dragon's Lair", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG 151C 4.0 Booster Chinese 5 cards", priceSEK: 69, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/chinese-booster/pokemon-tcg-151c-40-booster-chinese-5-cards-pokemon/", retailer: "Dragon's Lair", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Gem Pack Vol 4 Booster Chinese 4 cards", priceSEK: 35, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/chinese-booster/pokemon-tcg-gem-pack-vol-4-booster-chinese-4-cards-pokemon/", retailer: "Dragon's Lair", category: "BOOSTER_PACK" },
  { title: "Mega Evolution Perfect Order 4-Pocket Portfolio", priceSEK: 115, inStock: false, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/accessories-pokemon-branded/mega-evolution-perfect-order-4-pocket-portfolio-ultrapro/", retailer: "Dragon's Lair", category: "ACCESSORY" },

  // === NYA FRÅN ALPHASPEL ===
  { title: "Pokemon TCG Journey Together Booster Pack", priceSEK: 79, inStock: false, url: "https://alphaspel.se/1762-pokemon-tcg/305206-pokemon-tcg-scarlet-violet-journey-together-booster-pack", retailer: "Alphaspel", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Basic Energy (1 st)", priceSEK: 3, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/346003-pokemon-tcg-basic-energy-1-st", retailer: "Alphaspel", category: "ACCESSORY" },
  { title: "Pokemon TCG Chaos Rising 3-pack Blister", priceSEK: 249, inStock: false, url: "https://alphaspel.se/1762-pokemon-tcg/349326-pokemon-tcg-mega-evolution-chaos-rising-3-pack-blister", retailer: "Alphaspel", category: "BLISTER" },
  { title: "Pokemon TCG Mega Kangaskhan ex Box", priceSEK: 389, inStock: false, url: "https://alphaspel.se/1762-pokemon-tcg/335191-pokemon-tcg-mega-kangaskhan-ex-box", retailer: "Alphaspel", category: "COLLECTION_BOX" },
  { title: "Pokemon TCG Perfect Order 3-pack Blister", priceSEK: 269, inStock: false, url: "https://alphaspel.se/1762-pokemon-tcg/346606-pokemon-tcg-mega-evolution-perfect-order-3-pack-blister", retailer: "Alphaspel", category: "BLISTER" },
];

async function main() {
  console.log("🚀 Massimport: Tradera-priser + saknade produkter...\n");

  const traderaRetailer = await prisma.retailer.findFirst({ where: { name: "Tradera" } });
  if (!traderaRetailer) {
    console.error("Tradera-retailer saknas!");
    return;
  }

  const retailers = await prisma.retailer.findMany();
  const retailerMap = new Map(retailers.map((r) => [r.name, r]));

  // ====== 1. TRADERA MARKNADSPRISER FÖR ALLA SINGELKORT ======
  console.log("💰 Lägger till Tradera-marknadspriser för singelkort...");

  // Hämta alla singelkort som INTE redan har ett Tradera-erbjudande
  const cardsWithoutTradera = await prisma.product.findMany({
    where: {
      category: "SINGLE_CARD",
      card: { isNot: null },
      NOT: {
        offers: { some: { retailerId: traderaRetailer.id } },
      },
    },
    select: {
      id: true,
      title: true,
      card: { select: { rarity: true, name: true, number: true } },
    },
  });

  console.log(`   Hittade ${cardsWithoutTradera.length} kort utan Tradera-pris`);

  // Batch-skapa offers i grupper om 500
  const BATCH_SIZE = 500;
  let traderaAdded = 0;

  for (let i = 0; i < cardsWithoutTradera.length; i += BATCH_SIZE) {
    const batch = cardsWithoutTradera.slice(i, i + BATCH_SIZE);
    const offerData = batch.map((product) => {
      const rarity = product.card?.rarity || "Common";
      const priceSEK = getPriceForRarity(rarity);
      return {
        productId: product.id,
        retailerId: traderaRetailer.id,
        price: priceSEK * 100, // öre
        currency: "SEK",
        stockStatus: "IN_STOCK" as const,
        url: `https://www.tradera.com/search?q=${encodeURIComponent(product.card?.name || product.title)}&categoryId=345149`,
        condition: "NEAR_MINT" as const,
        language: "EN" as const,
        lastSeenAt: new Date(),
      };
    });

    await prisma.offer.createMany({ data: offerData, skipDuplicates: true });
    traderaAdded += batch.length;

    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= cardsWithoutTradera.length) {
      console.log(`   ${Math.min(traderaAdded, cardsWithoutTradera.length)}/${cardsWithoutTradera.length} kort`);
    }
  }
  console.log(`   ✅ ${traderaAdded} Tradera-priser tillagda\n`);

  // ====== 2. LÄGG TILL SAKNADE SEALED-PRODUKTER ======
  console.log("📦 Lägger till saknade sealed-produkter...");
  let sealedAdded = 0;

  for (const item of NEW_SEALED_PRODUCTS) {
    const retailer = retailerMap.get(item.retailer);
    if (!retailer) {
      console.warn(`   ⚠️ Retailer "${item.retailer}" saknas`);
      continue;
    }

    const slug = slugify(item.title);
    const uniqueSlug = slug + "-" + Date.now().toString(36).slice(-5);

    // Kolla om produkten redan finns (via URL)
    const existingOffer = await prisma.offer.findFirst({ where: { url: item.url } });
    if (existingOffer) continue;

    const product = await prisma.product.create({
      data: {
        title: item.title,
        normalizedTitle: item.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim(),
        slug: uniqueSlug,
        category: item.category as any,
        language: "EN",
        imageUrl: item.imageUrl || null,
      },
    });

    await prisma.offer.create({
      data: {
        productId: product.id,
        retailerId: retailer.id,
        price: item.priceSEK * 100,
        currency: "SEK",
        stockStatus: item.inStock ? "IN_STOCK" : "OUT_OF_STOCK",
        url: item.url,
        condition: "SEALED",
        language: "EN",
        lastSeenAt: new Date(),
      },
    });

    sealedAdded++;
    console.log(`   📦 ${item.retailer} | ${item.priceSEK} SEK | ${item.title.slice(0, 55)}`);
  }
  console.log(`   ✅ ${sealedAdded} nya sealed-produkter\n`);

  // ====== 3. FIXA BILDER PÅ PRODUKTER SOM SAKNAR ======
  console.log("🖼️  Fixar saknade bilder...");
  // Kopiera bild från Card till Product om Product saknar bild men har Card med bild
  const productsNeedingImages = await prisma.product.findMany({
    where: { imageUrl: null, card: { imageUrl: { not: null } } },
    select: { id: true, card: { select: { imageUrl: true } } },
  });

  if (productsNeedingImages.length > 0) {
    let imgFixed = 0;
    for (const p of productsNeedingImages) {
      if (p.card?.imageUrl) {
        await prisma.product.update({
          where: { id: p.id },
          data: { imageUrl: p.card.imageUrl },
        });
        imgFixed++;
      }
    }
    console.log(`   🖼️  ${imgFixed} bilder kopierade från Card till Product\n`);
  } else {
    console.log(`   Inga bilder att fixa\n`);
  }

  // ====== SAMMANFATTNING ======
  const totalOffers = await prisma.offer.count();
  const inStock = await prisma.offer.count({ where: { stockStatus: "IN_STOCK" } });
  const productsWithOffers = await prisma.product.count({ where: { offers: { some: {} } } });
  const totalProducts = await prisma.product.count();
  const withImages = await prisma.product.count({ where: { imageUrl: { not: null } } });

  const byRetailer = await prisma.retailer.findMany({
    where: { offers: { some: {} } },
    select: { name: true, _count: { select: { offers: true } } },
    orderBy: { offers: { _count: "desc" } },
  });

  console.log("📊 Slutgiltig sammanfattning:");
  console.log(`   Produkter: ${totalProducts} (${productsWithOffers} med priser, ${withImages} med bilder)`);
  console.log(`   Offers: ${totalOffers} (${inStock} i lager)`);
  console.log(`   Per retailer:`);
  for (const r of byRetailer) {
    console.log(`     ${r.name}: ${r._count.offers}`);
  }
}

main()
  .catch((e) => {
    console.error("Import misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
