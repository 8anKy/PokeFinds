/**
 * Importerar riktiga priser hämtade via Firecrawl från svenska butiker + Tradera.
 * Data är verifierad 2026-06-11.
 *
 * Körs med: npx tsx scripts/import-real-prices.ts
 */
import { PrismaClient } from "@prisma/client";
import { normalizeTitle, slugify } from "../src/lib/utils";

const prisma = new PrismaClient();

interface RealProduct {
  title: string;
  priceSEK: number;
  inStock: boolean;
  url: string;
  retailer: string;
  category: string;
}

// Alla riktiga produkter från Firecrawl-skrapningen 2026-06-11
const REAL_PRODUCTS: RealProduct[] = [
  // === WEBHALLEN (sealed only) ===
  { title: "Pokemon ME4 Chaos Rising Elite Trainer Box", priceSEK: 849, inStock: true, url: "https://www.webhallen.com/se/product/398336-Pokemon-ME4-Chaos-Rising-Elite-Trainer-Box", retailer: "Webhallen", category: "ETB" },
  { title: "Pokemon SV10: Destined Rivals Display (36 boosters)", priceSEK: 3499, inStock: true, url: "https://www.webhallen.com/se/product/396785-Pokemon-SV10-Destined-Rivals-Display-36-boosters", retailer: "Webhallen", category: "BOOSTER_BOX" },
  { title: "Pokemon Mega Zygarde Premium EX Collection", priceSEK: 749, inStock: true, url: "https://www.webhallen.com/se/product/398048-Pokemon-Mega-Zygarde-Premium-EX-Collection", retailer: "Webhallen", category: "COLLECTION_BOX" },
  { title: "Pokemon Battle Academy Pikachu vs Eevee vs Cinderace", priceSEK: 349, inStock: true, url: "https://www.webhallen.com/se/product/345269-Pokemon-Battle-Academy-Pikachu-vs-Eevee-vs-Cinderace", retailer: "Webhallen", category: "BUNDLE" },
  { title: "Pokemon ME4 Chaos Rising Booster Display (36)", priceSEK: 2299, inStock: true, url: "https://www.webhallen.com/se/product/398352-Pokemon-ME4-Chaos-Rising-Booster-Display", retailer: "Webhallen", category: "BOOSTER_BOX" },
  { title: "Pokemon ME4 Chaos Rising Booster Bundle", priceSEK: 499, inStock: true, url: "https://www.webhallen.com/se/product/398353-Pokemon-ME4-Chaos-Rising-Booster-Bundle", retailer: "Webhallen", category: "BUNDLE" },
  { title: "Pokemon Mega Lucario ex League Battle Deck", priceSEK: 549, inStock: true, url: "https://www.webhallen.com/se/product/398347-Pokemon-Mega-Lucario-ex-League-Battle-Deck", retailer: "Webhallen", category: "BUNDLE" },
  { title: "Pokemon ME4 Chaos Rising Checklane Booster", priceSEK: 89, inStock: true, url: "https://www.webhallen.com/se/product/398333-Pokemon-ME4-Chaos-Rising-Checklane-Booster", retailer: "Webhallen", category: "BOOSTER_PACK" },
  { title: "Pokemon ME4 Chaos Rising Premium Checklane Blister", priceSEK: 119, inStock: true, url: "https://www.webhallen.com/se/product/398342-Pokemon-ME4-Chaos-Rising-Premium-Checklane", retailer: "Webhallen", category: "BLISTER" },
  { title: "Pokemon ME4 Chaos Rising Sleeved Booster", priceSEK: 79, inStock: true, url: "https://www.webhallen.com/se/product/398343-Pokemon-ME4-Chaos-Rising-Sleeved-Booster", retailer: "Webhallen", category: "BOOSTER_PACK" },
  { title: "Pokemon ME4 Chaos Rising Booster Pack", priceSEK: 79, inStock: true, url: "https://www.webhallen.com/se/product/398351-Pokemon-ME4-Chaos-Rising-Booster", retailer: "Webhallen", category: "BOOSTER_PACK" },
  { title: "Pokemon Mini Album w/ booster", priceSEK: 89, inStock: true, url: "https://www.webhallen.com/se/product/396737-Pokemon-Mini-Album-w-booster", retailer: "Webhallen", category: "ACCESSORY" },

  // === SPELEXPERTEN (sealed only) ===
  { title: "Pokemon TCG Prismatic Evolutions Elite Trainer Box", priceSEK: 695, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-prismatic-evolutions-elite-trainer-box.html", retailer: "Spelexperten", category: "ETB" },
  { title: "Pokemon TCG Ascended Heroes Booster Bundle", priceSEK: 649, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-ascended-heroes-booster-bundle.html", retailer: "Spelexperten", category: "BUNDLE" },
  { title: "Pokemon TCG Prismatic Evolutions Booster Bundle", priceSEK: 599, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-prismatic-evolutions-booster-bundle.html", retailer: "Spelexperten", category: "BUNDLE" },
  { title: "Pokemon TCG League Battle Deck Palkia VSTAR", priceSEK: 395, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-league-battle-deck-palkia-vstar.html", retailer: "Spelexperten", category: "BUNDLE" },
  { title: "Pokemon TCG League Battle Deck Team Rockets Mewtwo ex", priceSEK: 515, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-league-battle-deck-team-rockets-mewtwo-ex.html", retailer: "Spelexperten", category: "BUNDLE" },
  { title: "Pokemon TCG Surging Sparks Booster Pack", priceSEK: 70, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-surging-sparks-booster-pack.html", retailer: "Spelexperten", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Perfect Order Booster Pack", priceSEK: 70, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-perfect-order-booster-pack.html", retailer: "Spelexperten", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Phantasmal Flames Booster Pack", priceSEK: 70, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-phantasmal-flames-booster-pack.html", retailer: "Spelexperten", category: "BOOSTER_PACK" },
  { title: "Pokemon Trading Card Game Classic", priceSEK: 4495, inStock: true, url: "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-trading-card-game-classic.html", retailer: "Spelexperten", category: "BUNDLE" },

  // === DRAGON'S LAIR (sealed only) ===
  { title: "Pokemon TCG Mega Evolution Chaos Rising Premium Checklane Blister", priceSEK: 119, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/english-booster-c1735/pokemon-tcg-mega-evolution-chaos-rising-premium-checklane-blister-pokemon/", retailer: "Dragon's Lair", category: "BLISTER" },
  { title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle", priceSEK: 499, inStock: false, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/english-booster-c1735/pokemon-tcg-mega-evolution-chaos-rising-booster-bundle-pokemon/", retailer: "Dragon's Lair", category: "BUNDLE" },
  { title: "Mega Evolution Perfect Order 9-Pocket Portfolio", priceSEK: 179, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/accessories-pokemon-branded/mega-evolution-perfect-order-9-pocket-portfolio-ultrapro/", retailer: "Dragon's Lair", category: "ACCESSORY" },
  { title: "Pokemon TCG 151C HOPE 4.0 Booster Chinese 5 cards", priceSEK: 69, inStock: true, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/boosters-c573/chinese-booster/pokemon-tcg-151c-hope-40-booster-chinese-5-cards-pokemon/", retailer: "Dragon's Lair", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Ascended Heroes First Partners Deluxe Pin Collection", priceSEK: 795, inStock: false, url: "https://dragonslair.se/en/tcgs/pokemon-the-card-game/by-set-c579/special-series/pokemon-tcg-ascended-heroes-first-partners-deluxe-pin-collection-pokemon/", retailer: "Dragon's Lair", category: "COLLECTION_BOX" },

  // === ALPHASPEL (sealed + singles) ===
  { title: "Pokemon TCG Scarlet Violet Destined Rivals Booster Pack", priceSEK: 119, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/298568-pokemon-tcg-scarlet-violet-destined-rivals-booster-pack", retailer: "Alphaspel", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Mega Evolution Chaos Rising Booster Pack", priceSEK: 79, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/349392-pokemon-tcg-mega-evolution-chaos-rising-booster-pack", retailer: "Alphaspel", category: "BOOSTER_PACK" },
  { title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle (6)", priceSEK: 549, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/349325-pokemon-tcg-mega-evolution-chaos-rising-booster-bundle-6", retailer: "Alphaspel", category: "BUNDLE" },
  { title: "Pokemon TCG Mega Evolution Chaos Rising Booster Display (36)", priceSEK: 2499, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/349391-pokemon-tcg-mega-evolution-chaos-rising-booster-display-36", retailer: "Alphaspel", category: "BOOSTER_BOX" },
  { title: "Pokemon TCG Mega Evolution Chaos Rising Premium Checklane Blister", priceSEK: 119, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/349395-pokemon-tcg-mega-evolution-chaos-rising-premium-checklane-blister", retailer: "Alphaspel", category: "BLISTER" },
  { title: "Pokemon TCG Mega Evolution Chaos Rising Checklane Blister", priceSEK: 109, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/349393-pokemon-tcg-mega-evolution-chaos-rising-checklane-blister", retailer: "Alphaspel", category: "BLISTER" },
  { title: "Pokemon TCG Mega Zygarde ex Premium Collection", priceSEK: 729, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/348779-pokemon-tcg-mega-zygarde-ex-premium-collection", retailer: "Alphaspel", category: "COLLECTION_BOX" },
  { title: "Pokemon TCG Team Rockets Mewtwo ex League Battle Deck", priceSEK: 499, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/335196-pokemon-tcg-team-rockets-mewtwo-ex-league-battle-deck", retailer: "Alphaspel", category: "BUNDLE" },
  { title: "Pokemon TCG Trainers Toolkit 2025", priceSEK: 599, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/306144-pokemon-tcg-trainers-toolkit-2025", retailer: "Alphaspel", category: "BUNDLE" },
  { title: "Pokemon TCG Palkia VSTAR League Battle Deck", priceSEK: 449, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/189363-pokemon-tcg-palkia-vstar-league-battle-deck", retailer: "Alphaspel", category: "BUNDLE" },
  { title: "Pokemon TCG Mega Charizard X ex Ultra Premium Collection", priceSEK: 2399, inStock: false, url: "https://alphaspel.se/1762-pokemon-tcg/335192-pokemon-tcg-mega-charizard-x-ex-ultra-premium-collection", retailer: "Alphaspel", category: "COLLECTION_BOX" },
  { title: "Pokemon TCG Sword Shield Astral Radiance Battle Build Stadium Box", priceSEK: 949, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/170312-pokemon-tcg-sword-shield-astral-radiance-battle-build-stadium-box", retailer: "Alphaspel", category: "BUNDLE" },
  { title: "Pokemon TCG Scarlet Violet Shrouded Fable Kingambit Illustration Collection", priceSEK: 399, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/230608-pokemon-tcg-scarlet-violet-shrouded-fable-kingambit-illustration-collection", retailer: "Alphaspel", category: "COLLECTION_BOX" },
  { title: "Pokemon TCG 2026 Spring Mini Album with Booster", priceSEK: 119, inStock: true, url: "https://alphaspel.se/1762-pokemon-tcg/348144-pokemon-tcg-2026-spring-mini-album-with-booster", retailer: "Alphaspel", category: "ACCESSORY" },

  // === TRADERA (singles — buy now listings) ===
  { title: "Raticate 099/088 Illustration Rare Full Art - Perfect Order", priceSEK: 149, inStock: true, url: "https://www.tradera.com/item/1001337/725853765/raticate-099-088-illustration-rare-full-art-perfect-order", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Tyme 143/131 Ultra Rare Full Art Trainer - Prismatic Evolutions", priceSEK: 99, inStock: true, url: "https://www.tradera.com/item/1001337/690333097/tyme-143-131-ultra-rare-full-art-trainer-prismatic-evolutions", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Mela 140/131 Ultra Rare Full Art Trainer - Prismatic Evolutions", priceSEK: 99, inStock: true, url: "https://www.tradera.com/item/1001337/668395748/mela-140-131-ultra-rare-full-art-trainer-prismatic-evolutions", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Eri 136/131 Ultra Rare Full Art Trainer - Prismatic Evolutions", priceSEK: 99, inStock: true, url: "https://www.tradera.com/item/1001337/723151557/eri-136-131-ultra-rare-full-art-trainer-prismatic-evolutions", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Galarian Sirfetch'd V 174/185 Ultra Rare Full Art - Vivid Voltage", priceSEK: 99, inStock: true, url: "https://www.tradera.com/item/293307/612558316/galarian-sirfetchd-v-174-185-ultra-rare-full-art-vivid-voltage", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Gordie 201/203 Ultra Rare Full Art Trainer - Evolving Skies", priceSEK: 149, inStock: true, url: "https://www.tradera.com/item/1001337/598688019/gordie-201-203-ultra-rare-full-art-trainer-evolving-skies", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Tyranitar 135/193 Holo Rare - Paldea Evolved", priceSEK: 29, inStock: true, url: "https://www.tradera.com/item/1001337/599325126/tyranitar-135-193-holo-rare-paldea-evolved", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Slaking 162/193 Holo Rare - Paldea Evolved", priceSEK: 19, inStock: true, url: "https://www.tradera.com/item/1001337/599326582/slaking-162-193-holo-rare-paldea-evolved", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Garganacl 123/193 Holo Rare - Paldea Evolved", priceSEK: 19, inStock: true, url: "https://www.tradera.com/item/1001337/599325500/garganacl-123-193-holo-rare-paldea-evolved", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Weavile 134/193 Holo Rare - Paldea Evolved", priceSEK: 19, inStock: true, url: "https://www.tradera.com/item/1001337/599324664/weavile-134-193-holo-rare-paldea-evolved", retailer: "Tradera", category: "SINGLE_CARD" },
  { title: "Pawmi 032/094 - Phantasmal Flames", priceSEK: 9, inStock: true, url: "https://www.tradera.com/item/1001337/729536629/pawmi-032-094-phantasmal-flames", retailer: "Tradera", category: "SINGLE_CARD" },
];

/**
 * Varje import-item får en unik nyckel baserad på retailer+url.
 * Vi mappar url -> productId för att undvika att liknande titlar kolliderar.
 */
const urlToProductId = new Map<string, string>();

async function getOrCreateProduct(item: RealProduct) {
  const slug = slugify(item.title);
  const normalized = normalizeTitle(item.title);

  // Exakt slug-match i DB?
  const existing = await prisma.product.findFirst({ where: { slug } });
  if (existing) return existing;

  // Skapa ny produkt med unik slug
  const uniqueSlug = slug + "-" + Date.now().toString(36).slice(-5);
  return prisma.product.create({
    data: {
      title: item.title,
      normalizedTitle: normalized,
      slug: uniqueSlug,
      category: item.category as any,
      language: "EN",
      imageUrl: null,
    },
  });
}

async function main() {
  console.log(`📦 Importerar ${REAL_PRODUCTS.length} riktiga priser från Firecrawl-data...\n`);

  // Rensa gamla offers så vi inte blandar gammalt och nytt
  const deleted = await prisma.offer.deleteMany();
  console.log(`   Rensade ${deleted.count} gamla offers`);

  // Skapa Tradera som ScrapeSource om den saknas
  await prisma.scrapeSource.upsert({
    where: { name: "Tradera" },
    update: { isActive: true },
    create: {
      name: "Tradera",
      baseUrl: "https://www.tradera.com",
      type: "SCRAPER",
      isActive: true,
      config: { robots: { allowed: true, note: "Publika sökresultat" } },
    },
  });

  // Skapa Tradera som Retailer om den saknas
  await prisma.retailer.upsert({
    where: { name: "Tradera" },
    update: {},
    create: {
      name: "Tradera",
      websiteUrl: "https://www.tradera.com",
      country: "SE",
      isActive: true,
      logoUrl: null,
    },
  });

  // Hämta alla retailers
  const retailers = await prisma.retailer.findMany();
  const retailerMap = new Map(retailers.map((r) => [r.name, r]));

  let created = 0;
  let skipped = 0;

  for (const item of REAL_PRODUCTS) {
    const retailer = retailerMap.get(item.retailer);
    if (!retailer) {
      console.warn(`   ⚠️ Retailer "${item.retailer}" saknas i DB`);
      skipped++;
      continue;
    }

    const priceOre = item.priceSEK * 100;
    const product = await getOrCreateProduct(item);

    // Upsert offer (hanterar fall där flera liknande produkter matchas till samma DB-produkt)
    const condition = item.category === "SINGLE_CARD" ? "NEAR_MINT" : "SEALED";
    await prisma.offer.upsert({
      where: {
        productId_retailerId_condition_language: {
          productId: product.id,
          retailerId: retailer.id,
          condition,
          language: "EN",
        },
      },
      update: {
        price: priceOre,
        currency: "SEK",
        stockStatus: item.inStock ? "IN_STOCK" : "OUT_OF_STOCK",
        url: item.url,
        lastSeenAt: new Date(),
      },
      create: {
        productId: product.id,
        retailerId: retailer.id,
        price: priceOre,
        currency: "SEK",
        stockStatus: item.inStock ? "IN_STOCK" : "OUT_OF_STOCK",
        url: item.url,
        condition,
        language: "EN",
        lastSeenAt: new Date(),
      },
    });

    console.log(`   ✅ ${item.retailer} | ${item.priceSEK} SEK | ${item.inStock ? "✓" : "✗"} | ${item.title.slice(0, 60)}`);
    created++;
  }

  const totalOffers = await prisma.offer.count();
  const inStock = await prisma.offer.count({ where: { stockStatus: "IN_STOCK" } });

  console.log(`\n✅ Klart!`);
  console.log(`   ${created} offers skapade (${skipped} hoppade över)`);
  console.log(`   Totalt i DB: ${totalOffers} offers (${inStock} i lager)`);
}

main()
  .catch((e) => {
    console.error("Import misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
