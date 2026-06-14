/**
 * Final data fix: better product images + more Tradera sold items.
 * Data from Firecrawl agents 2026-06-11.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Better product images from pokemoncenter.com and CDNs
const IMAGE_UPGRADES: { titleContains: string; imageUrl: string }[] = [
  { titleContains: "Chaos Rising Elite Trainer Box", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10030/P11219_10-10399-112_02.jpg" },
  { titleContains: "Mega Zygarde", imageUrl: "https://cdn11.bigcommerce.com/s-3b5vpig99v/images/stencil/original/products/670595/1534491/pokemon-tcg-premium-collection-mega-zygarde-ex-box__54035.1779287477.jpg" },
  { titleContains: "Battle Academy Pikachu", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10000/P7616_290-80906_01.jpg" },
  { titleContains: "Mega Lucario ex League Battle", imageUrl: "https://cdn11.bigcommerce.com/s-a0ebd/images/stencil/1280w/products/8929/23040/pokemon-mega-lucario-ex-league-battle-deck__17408.1777568933.jpg" },
  { titleContains: "Prismatic Evolutions Elite Trainer", imageUrl: "https://m.media-amazon.com/images/I/81qfGweCdDL.jpg" },
  { titleContains: "Ascended Heroes Booster Bundle", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10027/P11437_10-10311-114_01.jpg" },
  { titleContains: "Prismatic Evolutions Booster Bundle", imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/600518_in_1000x1000.jpg" },
  { titleContains: "Surging Sparks Booster Pack", imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/565604_in_1000x1000.jpg" },
  { titleContains: "Perfect Order Booster Pack", imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/672398_in_1000x1000.jpg" },
  { titleContains: "Phantasmal Flames Booster Pack", imageUrl: "https://m.media-amazon.com/images/I/61Tq1hBBegL.jpg" },
  { titleContains: "Team Rockets Mewtwo ex League Battle", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10122-101.jpg" },
  { titleContains: "Trainers Toolkit 2025", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10027/P10446_10-10112-101_03.jpg" },
  { titleContains: "Mega Charizard X ex Ultra Premium", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10021/P10448_10-10065-109_02.jpg" },
  { titleContains: "Astral Radiance Battle Build Stadium", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10000/P8153_181-85040_02.jpg" },
  { titleContains: "Kingambit Illustration Collection", imageUrl: "https://m.media-amazon.com/images/I/91Ip7EjYqYL._AC_UF894,1000_QL80_.jpg" },
  { titleContains: "Ascended Heroes First Partners Deluxe", imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/High/10030/P11429_10-10301-108_02.jpg" },
  { titleContains: "Destined Rivals Booster Pack", imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/624683_in_1000x1000.jpg" },
  { titleContains: "Palkia VSTAR League Battle", imageUrl: "https://m.media-amazon.com/images/I/91qF7mG6W6L.jpg" },
  { titleContains: "Trading Card Game Classic", imageUrl: "https://i.ebayimg.com/images/g/j9YAAOSw7INlVrjH/s-l1200.png" },
  { titleContains: "Mini Album", imageUrl: "https://m.media-amazon.com/images/I/61p5dXTiDhL._AC_UF894,1000_QL80_.jpg" },
  { titleContains: "Prismatic Evolutions Booster Display", imageUrl: "https://m.media-amazon.com/images/I/81qfGweCdDL.jpg" },
  { titleContains: "151 Booster Display", imageUrl: "https://m.media-amazon.com/images/I/81vNkLsHxYL.jpg" },
  { titleContains: "151 Elite Trainer", imageUrl: "https://m.media-amazon.com/images/I/81vNkLsHxYL.jpg" },
];

// Additional Tradera sold items (verified from Firecrawl search)
const MORE_TRADERA_SOLD: {
  title: string;
  priceSEK: number;
  url: string;
  category: string;
}[] = [
  // Booster Boxes
  { title: "Destined Rivals Booster Display (36) - Tradera Såld", priceSEK: 4500, url: "https://www.tradera.com/item/1001340/727428135/pokemon-destined-rivals-display", category: "BOOSTER_BOX" },
  { title: "Lost Origin Booster Box - Tradera Såld", priceSEK: 7999, url: "https://www.tradera.com/item/1001339/730109739/pokemon-lost-origin-booster-box", category: "BOOSTER_BOX" },
  { title: "Phantasmal Flames Booster Display - Tradera Såld", priceSEK: 2200, url: "https://www.tradera.com/item/1001340/705840917/pokemon-phantasmal-flames-display", category: "BOOSTER_BOX" },
  // ETBs
  { title: "Perfect Order Elite Trainer Box - Tradera Såld", priceSEK: 800, url: "https://www.tradera.com/item/1001341/730487830/pokemon-perfect-order-etb", category: "ETB" },
  { title: "Phantasmal Flames Elite Trainer Box - Tradera Såld", priceSEK: 888, url: "https://www.tradera.com/item/1001341/711019020/pokemon-phantasmal-flames-etb", category: "ETB" },
  { title: "Celebrations 25th Anniversary Elite Trainer Box - Tradera Såld", priceSEK: 3300, url: "https://www.tradera.com/item/1001341/720160659/pokemon-celebrations-etb", category: "ETB" },
  { title: "Evolving Skies Pokemon Center Elite Trainer Box - Tradera Såld", priceSEK: 13500, url: "https://www.tradera.com/item/1001341/713110282/pokemon-evolving-skies-pc-etb", category: "ETB" },
  // Singles (graded)
  { title: "Charizard Star Pokemon - Tradera Såld", priceSEK: 2050, url: "https://www.tradera.com/item/293307/730009331/charizard-pokemon", category: "SINGLE_CARD" },
  { title: "Pikachu Grey Felt Hat Van Gogh PSA 9 - Tradera Såld", priceSEK: 4500, url: "https://www.tradera.com/item/1001338/716556284/pikachu-van-gogh-psa-9", category: "GRADED_CARD" },
  { title: "Zapdos Holo 1999 Base Set PSA 10 - Tradera Såld", priceSEK: 9984, url: "https://www.tradera.com/item/1001338/717482983/zapdos-holo-1999-psa-10", category: "GRADED_CARD" },
  { title: "Charizard ex 183/165 PSA 9 - Scarlet & Violet 151 Såld", priceSEK: 660, url: "https://www.tradera.com/item/1001338/707250790/charizard-ex-151-psa-9", category: "GRADED_CARD" },
  { title: "Charmeleon 24/102 1st Edition Base Set PSA 8 - Tradera Såld", priceSEK: 1400, url: "https://www.tradera.com/item/1001338/715617925/charmeleon-1st-edition-psa-8", category: "GRADED_CARD" },
  // Blisters
  { title: "Pokemon Day Collection Blister 30 år - Tradera Såld", priceSEK: 349, url: "https://www.tradera.com/item/1001341/723788884/pokemon-day-blister-30", category: "BLISTER" },
  { title: "Crown Zenith 3-pack Blister Cinderace Promo - Tradera Såld", priceSEK: 587, url: "https://www.tradera.com/item/1001342/725870503/crown-zenith-blister-cinderace", category: "BLISTER" },
];

async function main() {
  console.log("🔧 Final data fix: bilder + Tradera-sålda...\n");

  // 1. Upgrade images
  console.log("🖼️  Uppgraderar produktbilder...");
  let upgraded = 0;
  for (const img of IMAGE_UPGRADES) {
    const result = await prisma.product.updateMany({
      where: { title: { contains: img.titleContains, mode: "insensitive" } },
      data: { imageUrl: img.imageUrl },
    });
    if (result.count > 0) {
      upgraded += result.count;
    }
  }
  console.log(`   Uppgraderade ${upgraded} produktbilder\n`);

  // 2. Add more Tradera sold items
  console.log("🏷️  Lägger till fler Tradera-sålda...");
  const traderaRetailer = await prisma.retailer.findFirst({ where: { name: "Tradera" } });
  if (!traderaRetailer) {
    console.log("   ⚠️ Tradera saknas");
    return;
  }

  let added = 0;
  for (const sold of MORE_TRADERA_SOLD) {
    const slug = sold.title
      .toLowerCase()
      .replace(/[åäöé]/g, (c) => ({ å: "a", ä: "a", ö: "o", é: "e" }[c] || c))
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const normalized = sold.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

    const uniqueSlug = slug + "-" + Date.now().toString(36).slice(-5);
    const product = await prisma.product.create({
      data: {
        title: sold.title,
        normalizedTitle: normalized,
        slug: uniqueSlug,
        category: sold.category as any,
        language: "EN",
        imageUrl: null,
      },
    });

    await prisma.offer.create({
      data: {
        productId: product.id,
        retailerId: traderaRetailer.id,
        price: sold.priceSEK * 100,
        currency: "SEK",
        stockStatus: "OUT_OF_STOCK",
        url: sold.url,
        condition: ["SINGLE_CARD", "GRADED_CARD"].includes(sold.category) ? "NEAR_MINT" : "SEALED",
        language: "EN",
        lastSeenAt: new Date(),
      },
    });
    added++;
    console.log(`   🏷️  ${sold.priceSEK} SEK | ${sold.title.slice(0, 60)}`);
  }
  console.log(`   Lade till ${added} sålda objekt\n`);

  // Summary
  const totalOffers = await prisma.offer.count();
  const inStock = await prisma.offer.count({ where: { stockStatus: "IN_STOCK" } });
  const outOfStock = await prisma.offer.count({ where: { stockStatus: "OUT_OF_STOCK" } });
  const byRetailer = await prisma.retailer.findMany({
    where: { offers: { some: {} } },
    select: { name: true, _count: { select: { offers: true } } },
  });

  console.log("📊 Slutgiltig sammanfattning:");
  console.log(`   Totalt: ${totalOffers} offers (${inStock} i lager, ${outOfStock} slut)`);
  for (const r of byRetailer) {
    console.log(`   ${r.name}: ${r._count.offers} offers`);
  }
}

main()
  .catch((e) => {
    console.error("Fix misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
