/**
 * Comprehensive cleanup:
 * 1. Merge exact duplicate products (same normalizedTitle)
 * 2. Merge near-duplicate sealed products (same product, different title formatting)
 * 3. Fix broken Tradera /sold/ URLs
 * 4. Fix homepage-only retailer URLs (delete useless offers)
 * 5. Fix Tradera search URLs to be cleaner
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Near-duplicate mapping: normalized key -> keep this ID (the one with most offers or best title)
// We'll compute this dynamically

function normalizeForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/pokémon/g, "pokemon")
    .replace(/pokemon tcg:\s*/g, "")
    .replace(/pokemon tcg\s*/g, "")
    .replace(/scarlet & violet\s*-?\s*/g, "")
    .replace(/scarlet violet\s*/g, "")
    .replace(/sword & shield\s*-?\s*/g, "")
    .replace(/sword shield\s*/g, "")
    .replace(/mega evolution\s*-?\s*/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

async function main() {
  console.log("=== CLEANUP: duplicates, URLs, images ===\n");

  // ============================================
  // STEP 1: Merge exact duplicates (same normalizedTitle)
  // ============================================
  console.log("1. Merging exact duplicates...");

  const dupeGroups = await prisma.product.groupBy({
    by: ["normalizedTitle"],
    _count: true,
    having: { normalizedTitle: { _count: { gt: 1 } } },
  });

  let mergedExact = 0;
  let deletedExact = 0;

  for (const group of dupeGroups) {
    const products = await prisma.product.findMany({
      where: { normalizedTitle: group.normalizedTitle },
      include: { offers: true },
      orderBy: { offers: { _count: "desc" } },
    });

    // Keep the first one (most offers), merge the rest into it
    const keeper = products[0];
    const dupes = products.slice(1);

    for (const dupe of dupes) {
      // Move offers from dupe to keeper (skip if unique constraint would fail)
      for (const offer of dupe.offers) {
        const existing = await prisma.offer.findFirst({
          where: {
            productId: keeper.id,
            retailerId: offer.retailerId,
            condition: offer.condition,
            language: offer.language,
          },
        });

        if (!existing) {
          await prisma.offer.update({
            where: { id: offer.id },
            data: { productId: keeper.id },
          });
        } else {
          // Keep the one with the better URL or higher price
          await prisma.offer.delete({ where: { id: offer.id } });
        }
      }

      // Delete any remaining relations (watchlist, priceObservation, etc.)
      await prisma.priceObservation.deleteMany({ where: { productId: dupe.id } });
      await prisma.watchlistItem.deleteMany({ where: { productId: dupe.id } });
      await prisma.collectionItem.deleteMany({ where: { productId: dupe.id } });

      // Delete the duplicate product
      await prisma.product.delete({ where: { id: dupe.id } });
      deletedExact++;
    }
    mergedExact++;
  }
  console.log("   Merged " + mergedExact + " groups, deleted " + deletedExact + " duplicate products\n");

  // ============================================
  // STEP 2: Merge near-duplicates (sealed products with different formatting)
  // ============================================
  console.log("2. Merging near-duplicate sealed products...");

  const sealedProducts = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    include: { offers: true },
    orderBy: { offers: { _count: "desc" } },
  });

  const nearDupeGroups = new Map<string, typeof sealedProducts>();
  for (const prod of sealedProducts) {
    const key = normalizeForDedup(prod.title);
    if (!nearDupeGroups.has(key)) nearDupeGroups.set(key, []);
    nearDupeGroups.get(key)!.push(prod);
  }

  let mergedNear = 0;
  let deletedNear = 0;

  for (const [key, prods] of nearDupeGroups) {
    if (prods.length <= 1) continue;

    // Already sorted by offer count desc — keep first
    const keeper = prods[0];
    const dupes = prods.slice(1);

    for (const dupe of dupes) {
      for (const offer of dupe.offers) {
        const existing = await prisma.offer.findFirst({
          where: {
            productId: keeper.id,
            retailerId: offer.retailerId,
            condition: offer.condition,
            language: offer.language,
          },
        });

        if (!existing) {
          await prisma.offer.update({
            where: { id: offer.id },
            data: { productId: keeper.id },
          });
        } else {
          await prisma.offer.delete({ where: { id: offer.id } });
        }
      }

      await prisma.priceObservation.deleteMany({ where: { productId: dupe.id } });
      await prisma.watchlistItem.deleteMany({ where: { productId: dupe.id } });
      await prisma.collectionItem.deleteMany({ where: { productId: dupe.id } });
      await prisma.product.delete({ where: { id: dupe.id } });
      deletedNear++;
    }
    mergedNear++;
  }
  console.log("   Merged " + mergedNear + " near-dupe groups, deleted " + deletedNear + " products\n");

  // ============================================
  // STEP 3: Fix broken Tradera /sold/ URLs
  // ============================================
  console.log("3. Fixing Tradera /sold/ URLs...");

  const soldOffers = await prisma.offer.findMany({
    where: { url: { contains: "/sold/" } },
    include: { product: { select: { title: true } } },
  });

  for (const offer of soldOffers) {
    const searchQuery = offer.product.title
      .replace(/ - Tradera.*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    await prisma.offer.update({
      where: { id: offer.id },
      data: { url: "https://www.tradera.com/search?q=" + encodeURIComponent(searchQuery) },
    });
  }
  console.log("   Fixed " + soldOffers.length + " /sold/ URLs\n");

  // ============================================
  // STEP 4: Delete homepage-only offers (useless links)
  // ============================================
  console.log("4. Removing useless homepage-only offers...");

  const homepageOffers = await prisma.offer.findMany({
    where: {
      OR: [
        { url: { endsWith: ".se" } },
        { url: { endsWith: ".se/" } },
        { url: { endsWith: ".com" } },
        { url: { endsWith: ".com/" } },
      ],
    },
    select: { id: true, url: true, product: { select: { title: true } }, retailer: { select: { name: true } } },
  });

  for (const offer of homepageOffers) {
    await prisma.offer.delete({ where: { id: offer.id } });
    console.log("   Removed: " + offer.retailer.name + " | " + offer.product.title.slice(0, 50));
  }
  console.log("   Deleted " + homepageOffers.length + " homepage-only offers\n");

  // ============================================
  // STEP 5: Clean up Tradera search URLs (make them cleaner)
  // ============================================
  console.log("5. Cleaning Tradera search URLs...");

  const traderaSearchOffers = await prisma.offer.findMany({
    where: { url: { contains: "tradera.com/search" } },
    include: { product: { select: { title: true } } },
  });

  let cleanedUrls = 0;
  for (const offer of traderaSearchOffers) {
    // Create a cleaner search query from the product title
    let query = offer.product.title
      .replace(/Pokémon TCG:\s*/i, "")
      .replace(/Pokemon TCG:\s*/i, "")
      .replace(/Pokemon TCG\s*/i, "")
      .replace(/ - Tradera.*$/i, "")
      .replace(/Såld$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

    const newUrl = "https://www.tradera.com/search?q=" + encodeURIComponent("Pokemon " + query);
    if (newUrl !== offer.url) {
      await prisma.offer.update({
        where: { id: offer.id },
        data: { url: newUrl },
      });
      cleanedUrls++;
    }
  }
  console.log("   Cleaned " + cleanedUrls + " search URLs\n");

  // ============================================
  // STEP 6: Verify real retailer URLs are reasonable
  // ============================================
  console.log("6. Checking retailer URLs...");

  const retailerOffers = await prisma.offer.findMany({
    where: {
      retailer: { name: { notIn: ["Tradera"] } },
    },
    select: { id: true, url: true, retailer: { select: { name: true } }, product: { select: { title: true } } },
  });

  let badRetailerUrls = 0;
  for (const offer of retailerOffers) {
    // Check if URL has a proper product path
    try {
      const url = new URL(offer.url);
      if (url.pathname === "/" || url.pathname === "") {
        badRetailerUrls++;
        console.log("   Bad: " + offer.retailer.name + " | " + offer.url + " | " + offer.product.title.slice(0, 40));
      }
    } catch {
      badRetailerUrls++;
      console.log("   Invalid URL: " + offer.url);
    }
  }
  console.log("   Found " + badRetailerUrls + " bad retailer URLs\n");

  // ============================================
  // SUMMARY
  // ============================================
  const totalProducts = await prisma.product.count();
  const totalOffers = await prisma.offer.count();
  const withOffers = await prisma.product.count({ where: { offers: { some: {} } } });
  const withImages = await prisma.product.count({ where: { imageUrl: { not: null } } });
  const noOffers = await prisma.product.count({ where: { offers: { none: {} } } });
  const noImages = await prisma.product.count({ where: { imageUrl: null } });

  const byRetailer = await prisma.retailer.findMany({
    where: { offers: { some: {} } },
    select: { name: true, _count: { select: { offers: true } } },
    orderBy: { offers: { _count: "desc" } },
  });

  // Check for any remaining duplicates
  const remainingDupes = await prisma.product.groupBy({
    by: ["normalizedTitle"],
    _count: true,
    having: { normalizedTitle: { _count: { gt: 1 } } },
  });

  console.log("=== FINAL STATUS ===");
  console.log("Products: " + totalProducts);
  console.log("  With prices: " + withOffers);
  console.log("  With images: " + withImages);
  console.log("  No prices: " + noOffers);
  console.log("  No images: " + noImages);
  console.log("Offers: " + totalOffers);
  for (const r of byRetailer) {
    console.log("  " + r.name + ": " + r._count.offers);
  }
  console.log("Remaining exact duplicates: " + remainingDupes.length);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
