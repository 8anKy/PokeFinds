/**
 * Final comprehensive fix:
 * 1. Fix broken/wrong images for sealed products (unique per product type)
 * 2. Add shipping prices to all offers
 * 3. Link sealed products to their sets (setId)
 * 4. Verify all image URLs work
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ===== 1. UNIQUE IMAGES PER SET + PRODUCT TYPE =====
// Format: "set keyword" -> { etb, box, pack, default }
const SET_PRODUCT_IMAGES: Record<string, { etb?: string; box?: string; pack?: string; default: string }> = {
  "evolving skies": {
    etb: "https://m.media-amazon.com/images/I/71CXkwLNnYL._AC_UF894,1000_QL80_.jpg",
    box: "https://m.media-amazon.com/images/I/81XLqAZ3kDL._AC_UF894,1000_QL80_.jpg",
    default: "https://m.media-amazon.com/images/I/81XLqAZ3kDL._AC_UF894,1000_QL80_.jpg",
  },
  "brilliant stars": {
    etb: "https://m.media-amazon.com/images/I/81Ib4HiQovL.jpg",
    box: "https://m.media-amazon.com/images/I/81Ib4HiQovL.jpg",
    default: "https://m.media-amazon.com/images/I/81Ib4HiQovL.jpg",
  },
  "astral radiance": {
    etb: "https://m.media-amazon.com/images/I/61C6B4fH1XL._AC_UF894,1000_QL80_.jpg",
    box: "https://m.media-amazon.com/images/I/61n8JzGw5DL.jpg",
    default: "https://m.media-amazon.com/images/I/61C6B4fH1XL._AC_UF894,1000_QL80_.jpg",
  },
  "perfect order": {
    etb: "https://m.media-amazon.com/images/I/81HZ8ZFNM5L.jpg",
    box: "https://m.media-amazon.com/images/I/81HZ8ZFNM5L.jpg",
    pack: "https://m.media-amazon.com/images/I/81HZ8ZFNM5L.jpg",
    default: "https://m.media-amazon.com/images/I/81HZ8ZFNM5L.jpg",
  },
  "surging sparks": {
    box: "https://m.media-amazon.com/images/I/81gt-LWXszL._AC_UF894,1000_QL80_.jpg",
    etb: "https://m.media-amazon.com/images/I/81xmePJfh0L._AC_UF894,1000_QL80_.jpg",
    default: "https://m.media-amazon.com/images/I/81gt-LWXszL._AC_UF894,1000_QL80_.jpg",
  },
  "scarlet & violet": {
    box: "https://m.media-amazon.com/images/I/91hUKX-tu5L.jpg",
    default: "https://m.media-amazon.com/images/I/91hUKX-tu5L.jpg",
  },
  "paldea evolved": {
    box: "https://m.media-amazon.com/images/I/71+zcN854mL.jpg",
    default: "https://m.media-amazon.com/images/I/71+zcN854mL.jpg",
  },
  "obsidian flames": {
    box: "https://m.media-amazon.com/images/I/613rMMod5eL.jpg",
    default: "https://m.media-amazon.com/images/I/613rMMod5eL.jpg",
  },
  "151": {
    box: "https://m.media-amazon.com/images/I/81vNkLsHxYL.jpg",
    etb: "https://m.media-amazon.com/images/I/81vNkLsHxYL.jpg",
    default: "https://m.media-amazon.com/images/I/81vNkLsHxYL.jpg",
  },
  "paradox rift": {
    etb: "https://m.media-amazon.com/images/I/91kMK4aMOIL.jpg",
    box: "https://m.media-amazon.com/images/I/91kMK4aMOIL.jpg",
    default: "https://m.media-amazon.com/images/I/91kMK4aMOIL.jpg",
  },
  "paldean fates": {
    box: "https://m.media-amazon.com/images/I/81m6e0EL04L.jpg",
    default: "https://m.media-amazon.com/images/I/81m6e0EL04L.jpg",
  },
  "temporal forces": {
    box: "https://m.media-amazon.com/images/I/81KKMS4jb8L.jpg",
    etb: "https://m.media-amazon.com/images/I/81KKMS4jb8L.jpg",
    default: "https://m.media-amazon.com/images/I/81KKMS4jb8L.jpg",
  },
  "twilight masquerade": {
    box: "https://m.media-amazon.com/images/I/914SNFm1BML.jpg",
    default: "https://m.media-amazon.com/images/I/914SNFm1BML.jpg",
  },
  "shrouded fable": {
    etb: "https://m.media-amazon.com/images/I/715bXXyctEL._AC_UF894,1000_QL80_.jpg",
    box: "https://m.media-amazon.com/images/I/81PYT9ru31L.jpg",
    default: "https://m.media-amazon.com/images/I/81PYT9ru31L.jpg",
  },
  "stellar crown": {
    box: "https://m.media-amazon.com/images/I/81tcdHmGw4L.jpg",
    default: "https://m.media-amazon.com/images/I/81tcdHmGw4L.jpg",
  },
  "prismatic evolutions": {
    etb: "https://m.media-amazon.com/images/I/81qfGweCdDL.jpg",
    box: "https://m.media-amazon.com/images/I/81qfGweCdDL.jpg",
    default: "https://m.media-amazon.com/images/I/81qfGweCdDL.jpg",
  },
  "journey together": {
    box: "https://m.media-amazon.com/images/I/71fEr7l8M4L.jpg",
    etb: "https://m.media-amazon.com/images/I/71fEr7l8M4L.jpg",
    default: "https://m.media-amazon.com/images/I/71fEr7l8M4L.jpg",
  },
  "destined rivals": {
    box: "https://m.media-amazon.com/images/I/81AFrfHlnCL._AC_UF894,1000_QL80_.jpg",
    etb: "https://m.media-amazon.com/images/I/81AFrfHlnCL._AC_UF894,1000_QL80_.jpg",
    default: "https://m.media-amazon.com/images/I/81AFrfHlnCL._AC_UF894,1000_QL80_.jpg",
  },
  "chaos rising": {
    box: "https://m.media-amazon.com/images/I/71P7kd2+9AL.jpg",
    etb: "https://m.media-amazon.com/images/I/71P7kd2+9AL.jpg",
    default: "https://m.media-amazon.com/images/I/71P7kd2+9AL.jpg",
  },
  "mega evolution": {
    box: "https://m.media-amazon.com/images/I/71P7kd2+9AL.jpg",
    etb: "https://m.media-amazon.com/images/I/71P7kd2+9AL.jpg",
    default: "https://m.media-amazon.com/images/I/71P7kd2+9AL.jpg",
  },
  "phantasmal flames": {
    box: "https://m.media-amazon.com/images/I/61Tq1hBBegL.jpg",
    etb: "https://m.media-amazon.com/images/I/61Tq1hBBegL.jpg",
    default: "https://m.media-amazon.com/images/I/61Tq1hBBegL.jpg",
  },
  "lost origin": {
    box: "https://m.media-amazon.com/images/I/81dYx2AGIPL.jpg",
    default: "https://m.media-amazon.com/images/I/81dYx2AGIPL.jpg",
  },
  "silver tempest": {
    box: "https://m.media-amazon.com/images/I/91OkJu1gLpL.jpg",
    etb: "https://m.media-amazon.com/images/I/91OkJu1gLpL.jpg",
    default: "https://m.media-amazon.com/images/I/91OkJu1gLpL.jpg",
  },
  "crown zenith": {
    box: "https://m.media-amazon.com/images/I/81K+DMCF0BL.jpg",
    etb: "https://m.media-amazon.com/images/I/81K+DMCF0BL.jpg",
    default: "https://m.media-amazon.com/images/I/81K+DMCF0BL.jpg",
  },
};

function getCorrectImage(title: string, category: string): string | null {
  const t = title.toLowerCase();
  for (const [setKey, images] of Object.entries(SET_PRODUCT_IMAGES)) {
    if (t.includes(setKey)) {
      if (category === "ETB" && images.etb) return images.etb;
      if (category === "BOOSTER_BOX" && images.box) return images.box;
      if (category === "BOOSTER_PACK" && images.pack) return images.pack;
      return images.default;
    }
  }
  return null;
}

// ===== 2. SHIPPING PRICES =====
const SHIPPING_PRICES: Record<string, number> = {
  "Tradera": 6900,      // 69 kr
  "Cardmarket": 4500,    // 45 kr (EU shipping to Sweden)
  "Spelexperten": 4900,  // 49 kr
  "Webhallen": 0,        // Free shipping
  "Alphaspel": 5900,     // 59 kr
  "Dragon's Lair": 4900, // 49 kr
};

async function main() {
  console.log("=== FINAL FIX ALL ===\n");

  // ============ 1. FIX IMAGES ============
  console.log("1. Fixing sealed product images...");
  const sealedProducts = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { id: true, title: true, category: true, imageUrl: true },
  });

  let imgFixed = 0;
  // First: replace the broken 81tKt8xjEKL.jpg URL and fix wrong images
  for (const prod of sealedProducts) {
    const correctImg = getCorrectImage(prod.title, prod.category);
    if (correctImg && correctImg !== prod.imageUrl) {
      await prisma.product.update({
        where: { id: prod.id },
        data: { imageUrl: correctImg },
      });
      imgFixed++;
    }
  }
  console.log("   Fixed " + imgFixed + " images\n");

  // ============ 2. ADD SHIPPING PRICES ============
  console.log("2. Adding shipping prices to all offers...");
  const retailers = await prisma.retailer.findMany();
  let shippingFixed = 0;
  for (const retailer of retailers) {
    const shipping = SHIPPING_PRICES[retailer.name];
    if (shipping !== undefined) {
      const result = await prisma.offer.updateMany({
        where: { retailerId: retailer.id, shippingPrice: null },
        data: { shippingPrice: shipping },
      });
      if (result.count > 0) {
        shippingFixed += result.count;
        console.log("   " + retailer.name + ": " + result.count + " offers -> " + (shipping / 100) + " kr shipping");
      }
    }
  }
  console.log("   Updated " + shippingFixed + " offers with shipping\n");

  // ============ 3. LINK SEALED PRODUCTS TO SETS ============
  console.log("3. Linking sealed products to their sets...");
  const sets = await prisma.cardSet.findMany({
    select: { id: true, name: true },
  });

  let setLinked = 0;
  const sealedNoSet = await prisma.product.findMany({
    where: {
      setId: null,
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] },
    },
    select: { id: true, title: true, normalizedTitle: true },
  });

  for (const prod of sealedNoSet) {
    const titleLower = (prod.normalizedTitle || prod.title).toLowerCase();
    // Find best matching set
    let bestSet: { id: string; name: string } | null = null;
    let bestLen = 0;
    for (const set of sets) {
      const setLower = set.name.toLowerCase();
      if (titleLower.includes(setLower) && setLower.length > bestLen) {
        bestSet = set;
        bestLen = setLower.length;
      }
    }
    if (bestSet) {
      await prisma.product.update({
        where: { id: prod.id },
        data: { setId: bestSet.id },
      });
      setLinked++;
    }
  }
  console.log("   Linked " + setLinked + "/" + sealedNoSet.length + " products to sets\n");

  // ============ 4. VERIFY IMAGES ============
  console.log("4. Verifying image URLs...");
  const uniqueImgs = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { imageUrl: true },
    distinct: ["imageUrl"],
  });

  let broken = 0;
  for (const img of uniqueImgs) {
    if (!img.imageUrl) continue;
    try {
      const res = await fetch(img.imageUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.status !== 200) {
        broken++;
        console.log("   BROKEN " + res.status + ": " + img.imageUrl.slice(0, 70));
      }
    } catch {
      broken++;
      console.log("   ERROR: " + img.imageUrl.slice(0, 70));
    }
  }
  console.log("   " + (broken === 0 ? "All images OK!" : broken + " broken images") + "\n");

  // ============ SUMMARY ============
  const totalProducts = await prisma.product.count();
  const totalOffers = await prisma.offer.count();
  const noShipping = await prisma.offer.count({ where: { shippingPrice: null } });
  const noSetSealed = await prisma.product.count({ where: { setId: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } } });

  console.log("=== FINAL STATUS ===");
  console.log("Products: " + totalProducts);
  console.log("Offers: " + totalOffers);
  console.log("Offers without shipping: " + noShipping);
  console.log("Sealed without setId: " + noSetSealed);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
