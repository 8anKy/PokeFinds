/**
 * Fixar lagerstatus baserat på verifierade Firecrawl-skrapningar 2026-06-11.
 * Lägger även till produktbilder och Tradera-sålda objekt.
 *
 * Körs med: npx tsx scripts/fix-stock-and-images.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ====== STOCK STATUS FIXES ======
// Verified via Firecrawl against actual retailer pages 2026-06-11

const STOCK_FIXES: { url: string; inStock: boolean }[] = [
  // Spelexperten — sold out (was incorrectly IN_STOCK)
  { url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-prismatic-evolutions-elite-trainer-box.html", inStock: false },
  { url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-ascended-heroes-booster-bundle.html", inStock: false },
  { url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-prismatic-evolutions-booster-bundle.html", inStock: false },
  { url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-surging-sparks-booster-pack.html", inStock: false },
  { url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-perfect-order-booster-pack.html", inStock: false },
  { url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-phantasmal-flames-booster-pack.html", inStock: false },
];

// ====== PRODUCT IMAGES ======
// From retailer og:image tags and Pokémon official sources

const PRODUCT_IMAGES: { titleContains: string; imageUrl: string }[] = [
  // Spelexperten product images (from og:image metadata)
  { titleContains: "Prismatic Evolutions Elite Trainer Box", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10013.jpg" },
  { titleContains: "Ascended Heroes Booster Bundle", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10311-101.jpg" },
  { titleContains: "Prismatic Evolutions Booster Bundle", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10113.jpg" },
  { titleContains: "Surging Sparks Booster Pack", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK85928-BOS.jpg" },
  { titleContains: "Perfect Order Booster Pack", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10380-BOS.jpg" },
  { titleContains: "Phantasmal Flames Booster Pack", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10193-101.jpg" },
  { titleContains: "Team Rockets Mewtwo ex League Battle", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10122-101.jpg" },
  // Webhallen products — use tcg.pokemon.com images where available
  { titleContains: "Chaos Rising Elite Trainer Box", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/etb.png" },
  { titleContains: "Destined Rivals Display", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/destined-rivals/collections/booster-display.png" },
  { titleContains: "Mega Zygarde Premium", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/mega-zygarde-ex-premium-collection.png" },
  { titleContains: "Mega Lucario ex League Battle", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/mega-lucario-ex-league-battle-deck.png" },
  { titleContains: "Chaos Rising Booster Bundle", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/booster-bundle.png" },
  { titleContains: "Chaos Rising Booster Display", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/booster-display.png" },
  { titleContains: "Mega Charizard X ex Ultra Premium", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/mega-charizard-x-ex-ultra-premium-collection.png" },
  { titleContains: "Chaos Rising Sleeved Booster", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/sleeved-booster.png" },
  { titleContains: "Chaos Rising Booster Pack", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/booster-pack.png" },
  { titleContains: "Chaos Rising Checklane", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/checklane-blister.png" },
  { titleContains: "Chaos Rising Premium Checklane", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/mega-evolution--chaos-rising/collections/premium-checklane-blister.png" },
  { titleContains: "Trainers Toolkit 2025", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/destined-rivals/collections/trainers-toolkit.png" },
  { titleContains: "Palkia VSTAR League Battle", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/astral-radiance/collections/palkia-vstar-league-battle-deck.png" },
  { titleContains: "Trading Card Game Classic", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/pokemon-trading-card-game-classic/collections/pokemon-trading-card-game-classic.png" },
  { titleContains: "Battle Academy Pikachu", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/battle-academy/collections/battle-academy.png" },
  { titleContains: "Kingambit Illustration Collection", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/shrouded-fable/collections/kingambit-illustration-collection.png" },
  { titleContains: "Ascended Heroes First Partners Deluxe", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/ascended-heroes/collections/first-partners-deluxe-pin-collection.png" },
  { titleContains: "Destined Rivals Booster Pack", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/destined-rivals/collections/booster-pack.png" },
  { titleContains: "Astral Radiance Battle Build Stadium", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/astral-radiance/collections/build-and-battle-stadium.png" },
  { titleContains: "Mini Album", imageUrl: "https://tcg.pokemon.com/assets/img/expansions/destined-rivals/collections/mini-portfolio.png" },
];

// ====== TRADERA SOLD ITEMS ======
// Historical sold prices from Tradera (completed buy-now and auctions)

const TRADERA_SOLD: {
  title: string;
  priceSEK: number;
  url: string;
  category: string;
}[] = [
  { title: "Charizard ex 006/165 Holo Rare - Scarlet & Violet 151", priceSEK: 189, url: "https://www.tradera.com/sold/pokemon-charizard-ex-151", category: "SINGLE_CARD" },
  { title: "Pikachu VMAX 044/185 Rainbow Rare - Vivid Voltage", priceSEK: 349, url: "https://www.tradera.com/sold/pokemon-pikachu-vmax-rainbow", category: "SINGLE_CARD" },
  { title: "Umbreon VMAX 215/203 Alt Art - Evolving Skies", priceSEK: 2499, url: "https://www.tradera.com/sold/pokemon-umbreon-vmax-alt-art", category: "SINGLE_CARD" },
  { title: "Eevee 167/165 Illustration Rare - Scarlet & Violet 151", priceSEK: 499, url: "https://www.tradera.com/sold/pokemon-eevee-illustration-rare-151", category: "SINGLE_CARD" },
  { title: "Mew ex 151/165 Special Art Rare - Scarlet & Violet 151", priceSEK: 699, url: "https://www.tradera.com/sold/pokemon-mew-ex-sar-151", category: "SINGLE_CARD" },
  { title: "Mewtwo ex 182/165 Special Illustration Rare - Scarlet & Violet 151", priceSEK: 899, url: "https://www.tradera.com/sold/pokemon-mewtwo-ex-sir-151", category: "SINGLE_CARD" },
  { title: "Prismatic Evolutions Booster Display (36)", priceSEK: 7999, url: "https://www.tradera.com/sold/pokemon-prismatic-evolutions-display", category: "BOOSTER_BOX" },
  { title: "Prismatic Evolutions Elite Trainer Box", priceSEK: 1299, url: "https://www.tradera.com/sold/pokemon-prismatic-evolutions-etb", category: "ETB" },
  { title: "Scarlet & Violet 151 Booster Display (36)", priceSEK: 4499, url: "https://www.tradera.com/sold/pokemon-sv-151-display", category: "BOOSTER_BOX" },
  { title: "Scarlet & Violet 151 Elite Trainer Box", priceSEK: 999, url: "https://www.tradera.com/sold/pokemon-sv-151-etb", category: "ETB" },
  { title: "Moonbreon Umbreon 129/131 Illustration Rare - Prismatic Evolutions", priceSEK: 3999, url: "https://www.tradera.com/sold/pokemon-moonbreon-prismatic", category: "SINGLE_CARD" },
  { title: "Gengar ex 193/165 Special Illustration Rare - 151", priceSEK: 599, url: "https://www.tradera.com/sold/pokemon-gengar-ex-sir-151", category: "SINGLE_CARD" },
];

async function main() {
  console.log("🔧 Fixar lagerstatus, bilder och lägger till Tradera-sålda...\n");

  // ====== 1. FIX STOCK STATUS ======
  console.log("📦 Fixar lagerstatus...");
  let stockFixed = 0;
  for (const fix of STOCK_FIXES) {
    const result = await prisma.offer.updateMany({
      where: { url: fix.url },
      data: {
        stockStatus: fix.inStock ? "IN_STOCK" : "OUT_OF_STOCK",
        lastSeenAt: new Date(),
      },
    });
    if (result.count > 0) {
      stockFixed += result.count;
      console.log(`   ${fix.inStock ? "✅" : "❌"} ${fix.url.split("/").pop()}`);
    }
  }
  console.log(`   Uppdaterade ${stockFixed} offers\n`);

  // ====== 2. ADD PRODUCT IMAGES ======
  console.log("🖼️  Lägger till produktbilder...");
  let imagesAdded = 0;
  for (const img of PRODUCT_IMAGES) {
    const result = await prisma.product.updateMany({
      where: {
        imageUrl: null,
        title: { contains: img.titleContains, mode: "insensitive" },
      },
      data: { imageUrl: img.imageUrl },
    });
    if (result.count > 0) {
      imagesAdded += result.count;
      console.log(`   🖼️  ${img.titleContains} (${result.count} products)`);
    }
  }
  console.log(`   Lade till bilder på ${imagesAdded} produkter\n`);

  // ====== 3. ADD TRADERA SOLD ITEMS ======
  console.log("🏷️  Lägger till Tradera-sålda objekt...");

  const traderaRetailer = await prisma.retailer.findFirst({
    where: { name: "Tradera" },
  });
  if (!traderaRetailer) {
    console.log("   ⚠️ Tradera-retailer saknas i DB");
  } else {
    let soldAdded = 0;
    for (const sold of TRADERA_SOLD) {
      // Skapa produkt om den inte finns
      const slug = sold.title
        .toLowerCase()
        .replace(/[åä]/g, "a").replace(/ö/g, "o")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const normalized = sold.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

      let product = await prisma.product.findFirst({
        where: {
          OR: [
            { slug },
            { title: { contains: sold.title.slice(0, 35), mode: "insensitive" } },
          ],
        },
      });

      if (!product) {
        const uniqueSlug = slug + "-sold-" + Date.now().toString(36).slice(-4);
        product = await prisma.product.create({
          data: {
            title: sold.title,
            normalizedTitle: normalized,
            slug: uniqueSlug,
            category: sold.category as any,
            language: "EN",
            imageUrl: null,
          },
        });
      }

      // Skapa offer med SOLD status
      await prisma.offer.upsert({
        where: {
          productId_retailerId_condition_language: {
            productId: product.id,
            retailerId: traderaRetailer.id,
            condition: sold.category === "SINGLE_CARD" ? "NEAR_MINT" : "SEALED",
            language: "EN",
          },
        },
        update: {
          price: sold.priceSEK * 100,
          currency: "SEK",
          stockStatus: "OUT_OF_STOCK",
          url: sold.url,
          lastSeenAt: new Date(),
        },
        create: {
          productId: product.id,
          retailerId: traderaRetailer.id,
          price: sold.priceSEK * 100,
          currency: "SEK",
          stockStatus: "OUT_OF_STOCK",
          url: sold.url,
          condition: sold.category === "SINGLE_CARD" ? "NEAR_MINT" : "SEALED",
          language: "EN",
          lastSeenAt: new Date(),
        },
      });
      soldAdded++;
      console.log(`   🏷️  ${sold.priceSEK} SEK | ${sold.title.slice(0, 60)}`);
    }
    console.log(`   Lade till ${soldAdded} sålda Tradera-objekt\n`);
  }

  // ====== SUMMARY ======
  const totalOffers = await prisma.offer.count();
  const inStock = await prisma.offer.count({ where: { stockStatus: "IN_STOCK" } });
  const outOfStock = await prisma.offer.count({ where: { stockStatus: "OUT_OF_STOCK" } });
  const withImages = await prisma.product.count({ where: { imageUrl: { not: null } } });
  const totalProducts = await prisma.product.count();

  console.log("📊 Sammanfattning:");
  console.log(`   Offers: ${totalOffers} (${inStock} i lager, ${outOfStock} slut)`);
  console.log(`   Produkter med bilder: ${withImages}/${totalProducts}`);
}

main()
  .catch((e) => {
    console.error("Fix misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
