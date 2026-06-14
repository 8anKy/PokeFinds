import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Map broken URL -> working replacement
const REPLACEMENTS: Record<string, string> = {
  // 151 Booster Box - use TCGPlayer CDN (Amazon was 404)
  "https://m.media-amazon.com/images/I/81vNkLsHxYL.jpg": "https://tcgplayer-cdn.tcgplayer.com/product/565243_in_1000x1000.jpg",
  // Lost Origin Booster Box
  "https://m.media-amazon.com/images/I/81dYx2AGIPL.jpg": "https://m.media-amazon.com/images/I/91gU9wk0dNL.jpg",
  // Crown Zenith ETB
  "https://m.media-amazon.com/images/I/81K+DMCF0BL.jpg": "https://m.media-amazon.com/images/I/81Z56bb4QwL.jpg",
  // Pokemon Day Collection Blister 30 years
  "https://m.media-amazon.com/images/I/81Qs5kYhGkL.jpg": "https://m.media-amazon.com/images/I/91YHLxggDmL.jpg",
  // Celebrations 25th Anniversary ETB
  "https://m.media-amazon.com/images/I/81y0yCeSjjL.jpg": "https://m.media-amazon.com/images/I/91zdZiupNJL.jpg",
  // Gem Pack Vol 3 Booster Chinese
  "https://m.media-amazon.com/images/I/71RkbfPEZ8L.jpg": "https://i.ebayimg.com/images/g/myMAAeSwKFlou50H/s-l1200.jpg",
  // Mega Kangaskhan ex Box
  "https://m.media-amazon.com/images/I/81IHl5TDe1L.jpg": "https://m.media-amazon.com/images/I/919EUgtiWxL.jpg",
  // Pokemon GO Battle Deck Mewtwo/Melmetal
  "https://m.media-amazon.com/images/I/81c5+M7kz7L.jpg": "https://m.media-amazon.com/images/I/61vsAiUvj9L.jpg",
};

async function main() {
  console.log("Fixing 8 broken image URLs...\n");

  // First verify all replacement URLs work
  for (const [oldUrl, newUrl] of Object.entries(REPLACEMENTS)) {
    try {
      const res = await fetch(newUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      console.log((res.status === 200 ? "OK" : "FAIL " + res.status) + ": " + newUrl.slice(0, 70));
      if (res.status !== 200) {
        console.log("  WARNING: replacement also broken!");
      }
    } catch {
      console.log("ERR: " + newUrl.slice(0, 70));
    }
  }

  // Apply replacements
  let fixed = 0;
  for (const [oldUrl, newUrl] of Object.entries(REPLACEMENTS)) {
    const result = await prisma.product.updateMany({
      where: { imageUrl: oldUrl },
      data: { imageUrl: newUrl },
    });
    if (result.count > 0) {
      fixed += result.count;
      console.log("Replaced " + result.count + " products: " + oldUrl.split("/").pop());
    }
  }
  console.log("\nTotal fixed: " + fixed);

  // Final verification
  console.log("\nVerifying all sealed images...");
  const allSealed = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { imageUrl: true, title: true },
    distinct: ["imageUrl"],
  });
  let broken = 0;
  for (const p of allSealed) {
    if (!p.imageUrl) continue;
    try {
      const res = await fetch(p.imageUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      if (res.status !== 200) {
        broken++;
        console.log("STILL BROKEN " + res.status + ": " + p.imageUrl.slice(0, 70) + " (" + p.title.slice(0, 30) + ")");
      }
    } catch {
      broken++;
      console.log("STILL ERR: " + p.imageUrl.slice(0, 70));
    }
  }
  console.log(broken === 0 ? "All sealed images now OK!" : broken + " still broken");
}

main().catch(console.error).finally(() => prisma.$disconnect());
