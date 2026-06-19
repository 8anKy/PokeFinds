/**
 * Kör alla aktiva skrapare manuellt och visar resultaten.
 *
 * Körs med: npx tsx scripts/run-scrapers.ts
 */
import { PrismaClient } from "@prisma/client";

// Måste importera med relativ sökväg (inte @/) för tsx utan alias
import { SpelexpertenAdapter } from "../src/scrapers/adapters/spelexperten-adapter";
import { WebhallenAdapter } from "../src/scrapers/adapters/webhallen-adapter";
import { DragonsLairAdapter } from "../src/scrapers/adapters/dragonslair-adapter";
import { AlphaspelAdapter } from "../src/scrapers/adapters/alphaspel-adapter";
import { TraderaAdapter } from "../src/scrapers/adapters/tradera-adapter";
import { normalizeTitle, slugify } from "../src/lib/utils";
import { isPlausibleListingPrice, matchProduct } from "../src/scrapers/matching";
import type { SourceAdapter, RawProductData } from "../src/scrapers/types";

const prisma = new PrismaClient();

/** Kategorifilter per butik — vilka produkttyper säljer butiken? */
const RETAILER_CATEGORIES: Record<string, Set<string>> = {
  // Webhallen säljer sealed (boxes, packs, ETBs) — inte singelkort
  Webhallen: new Set(["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "ACCESSORY", "OTHER"]),
  // Spelexperten säljer sealed
  Spelexperten: new Set(["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "ACCESSORY", "OTHER"]),
  // Dragon's Lair säljer sealed
  "Dragon's Lair": new Set(["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "ACCESSORY", "OTHER"]),
  // Alphaspel säljer sealed + singelkort
  Alphaspel: new Set(["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"]),
  // Tradera säljer allt (auktioner + köp nu)
  Tradera: new Set(["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"]),
};

const ADAPTERS: { name: string; adapter: SourceAdapter }[] = [
  { name: "Webhallen", adapter: new WebhallenAdapter() },
  { name: "Spelexperten", adapter: new SpelexpertenAdapter() },
  { name: "Dragon's Lair", adapter: new DragonsLairAdapter() },
  { name: "Alphaspel", adapter: new AlphaspelAdapter() },
  { name: "Tradera", adapter: new TraderaAdapter() },
];

/**
 * Lägsta pris som redan skrivits per offer-nyckel under denna körning —
 * när flera annonser matchar samma produkt ska offerten visa den billigaste,
 * inte den senast bearbetade.
 */
const bestPriceThisRun = new Map<string, number>();

/**
 * Försöker matcha en skrapad produkt mot en Product i databasen.
 * Returnerar product + retailer IDs om match hittas.
 */
async function matchAndUpsertOffer(
  raw: RawProductData,
  retailerName: string,
  sourceId: string
): Promise<boolean> {
  const category = raw.category ?? "OTHER";

  // Kolla om denna butik säljer denna kategori
  const allowedCategories = RETAILER_CATEGORIES[retailerName];
  if (allowedCategories && !allowedCategories.has(category)) {
    return false;
  }

  // Riktig fuzzy-matchning (bigram-Dice + setnummer + produktform-vakt)
  const match = await matchProduct(normalizeTitle(raw.title));
  if (!match) return false;

  const bestMatch = await prisma.product.findUnique({
    where: { id: match.productId },
    select: { id: true, category: true },
  });
  if (!bestMatch) return false;

  // Dubbelkolla kategorifilter mot matchad produkt
  if (allowedCategories && !allowedCategories.has(bestMatch.category)) {
    return false;
  }

  // Singelkort får bara matcha skrapade singelkort och vice versa —
  // hindrar t.ex. "Mini Tin" eller "Tech Sticker Collection Charmander"
  // från att hamna som pris på ett singelkort.
  const SINGLE_CATEGORIES = new Set(["SINGLE_CARD", "GRADED_CARD"]);
  if (SINGLE_CATEGORIES.has(bestMatch.category) !== SINGLE_CATEGORIES.has(category)) {
    return false;
  }

  // Rimlighetsvakt mot CM-marknadspriset (alla butiker/marknadsplatser): för HÖGT
  // = trolig lot/fel variant, för LÅGT = felmatchad produkt (t.ex. en 149 kr
  // butikslänk på en 2 333 kr sealed). Skippa helt — priset hör inte till produkten.
  if (!(await isPlausibleListingPrice(bestMatch.id, raw.price))) {
    console.log(`   ⚠️ Orimligt pris vs marknadspris (trolig lot/felmatch): "${raw.title}" ${raw.price} öre`);
    return false;
  }

  // Hitta retailer
  const retailer = await prisma.retailer.findFirst({
    where: { name: retailerName },
    select: { id: true },
  });
  if (!retailer) return false;

  // Skick utifrån produktkategori: singlar NEAR_MINT, övrigt SEALED.
  // Befintligt erbjudande från samma butik styr (undvik dubbletter).
  const previousOffer = await prisma.offer.findFirst({
    where: { productId: bestMatch.id, retailerId: retailer.id },
    select: { condition: true, language: true },
  });
  const condition =
    previousOffer?.condition ??
    (bestMatch.category === "SINGLE_CARD" || bestMatch.category === "GRADED_CARD"
      ? "NEAR_MINT"
      : "SEALED");
  const language = previousOffer?.language ?? "EN";

  // Billigaste annonsen vinner: har en billigare annons redan skrivit denna
  // offer under körningen behåller vi den, men sparar ändå observationen.
  const offerKey = `${bestMatch.id}:${retailer.id}:${condition}:${language}`;
  const cheaper = bestPriceThisRun.get(offerKey);
  if (cheaper !== undefined && cheaper <= raw.price) {
    await prisma.priceObservation.create({
      data: {
        productId: bestMatch.id,
        sourceId,
        price: raw.price,
        currency: raw.currency,
        condition,
        rawData: raw.raw as any,
      },
    });
    return true;
  }
  bestPriceThisRun.set(offerKey, raw.price);

  await prisma.offer.upsert({
    where: {
      productId_retailerId_condition_language: {
        productId: bestMatch.id,
        retailerId: retailer.id,
        condition,
        language,
      },
    },
    update: {
      price: raw.price,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      url: raw.url,
      lastSeenAt: new Date(),
    },
    create: {
      productId: bestMatch.id,
      retailerId: retailer.id,
      price: raw.price,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      url: raw.url,
      condition,
      language,
      lastSeenAt: new Date(),
    },
  });

  // Skapa prisobservation
  await prisma.priceObservation.create({
    data: {
      productId: bestMatch.id,
      sourceId,
      price: raw.price,
      currency: raw.currency,
      condition,
      rawData: raw.raw as any,
    },
  });

  return true;
}

async function main() {
  // Valfritt filter: npx tsx scripts/run-scrapers.ts Tradera
  const only = process.argv[2];
  console.log("🔍 Kör riktiga skrapare mot svenska butiker + Tradera...\n");

  for (const { name, adapter } of ADAPTERS) {
    if (only && name !== only) continue;
    console.log(`\n📡 ${name}...`);

    // Hitta source i DB
    const source = await prisma.scrapeSource.findFirst({
      where: { name },
      select: { id: true, isActive: true },
    });

    if (!source) {
      console.log(`   ⚠️ Ingen ScrapeSource "${name}" i databasen — hoppar över`);
      continue;
    }

    try {
      const result = await adapter.fetchProducts();
      console.log(`   Hämtade ${result.products.length} produkter`);
      if (result.errors.length > 0) {
        console.log(`   ⚠️ ${result.errors.length} fel:`);
        for (const err of result.errors.slice(0, 3)) {
          console.log(`      - ${err}`);
        }
      }

      let matched = 0;
      let skipped = 0;

      for (const raw of result.products) {
        if (!adapter.validateResult(raw)) {
          skipped++;
          continue;
        }
        const ok = await matchAndUpsertOffer(raw, name, source.id);
        if (ok) matched++;
        else skipped++;
      }

      console.log(`   ✅ ${matched} offers skapade/uppdaterade, ${skipped} omatchade`);

      // Uppdatera lastRunAt
      await prisma.scrapeSource.update({
        where: { id: source.id },
        data: { lastRunAt: new Date() },
      });
    } catch (err) {
      console.error(`   ❌ ${name} misslyckades: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Sammanfattning
  const offerCount = await prisma.offer.count();
  const inStockCount = await prisma.offer.count({ where: { stockStatus: "IN_STOCK" } });
  console.log(`\n🎉 Klart! ${offerCount} offers totalt (${inStockCount} i lager)`);
}

main()
  .catch((e) => {
    console.error("Scraper-körning misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
