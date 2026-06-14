import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  // Check which sealed products have wrong images
  // The screenshot shows Perfect Order ETB with a booster pack image
  // and Astral Radiance/Evolving Skies with broken images
  
  const problemProducts = await p.product.findMany({
    where: {
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] },
    },
    select: { id: true, title: true, imageUrl: true, category: true, setId: true },
    orderBy: { title: "asc" },
  });

  // Check which images are re-used across different product TYPES
  const byImage = new Map<string, { title: string; category: string }[]>();
  for (const p2 of problemProducts) {
    if (!p2.imageUrl) continue;
    if (!byImage.has(p2.imageUrl)) byImage.set(p2.imageUrl, []);
    byImage.get(p2.imageUrl)!.push({ title: p2.title, category: p2.category });
  }

  console.log("=== Images shared across DIFFERENT categories ===");
  for (const [url, products] of byImage) {
    const cats = new Set(products.map(pp => pp.category));
    if (cats.size > 1) {
      console.log("\n" + url.slice(0, 70));
      for (const pp of products) console.log("  " + pp.category + " | " + pp.title.slice(0, 60));
    }
  }

  // Check sealed products without setId
  const noSet = await p.product.count({ where: { setId: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } } });
  console.log("\nSealed without setId:", noSet);

  // Check shipping prices
  const noShipping = await p.offer.count({ where: { shippingPrice: null } });
  const totalOffers = await p.offer.count();
  console.log("Offers without shippingPrice:", noShipping, "/", totalOffers);

  // Test problematic images with HEAD requests
  const testUrls = [
    "https://m.media-amazon.com/images/I/81tKt8xjEKL.jpg", // Evolving Skies / Brilliant Stars / Astral Radiance
    "https://tcgplayer-cdn.tcgplayer.com/product/672398_in_1000x1000.jpg", // Perfect Order
  ];
  for (const url of testUrls) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      console.log(res.status + " " + (res.headers.get("content-type") || "?") + " " + url.slice(0, 60));
    } catch (e: any) {
      console.log("ERROR " + url.slice(0, 60) + " " + e.message?.slice(0, 40));
    }
  }
}
main().finally(() => p.$disconnect());
