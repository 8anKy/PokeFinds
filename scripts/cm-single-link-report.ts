/**
 * CM-ENKEL-LÄNK-RAPPORT: sealed-produkter vars Cardmarket-offer pekar på ett idProduct
 * som INTE finns i CM:s sealed-katalog (products_nonsingles_6.json) — dvs på ett ENSTAKA
 * KORT (single) eller ett ogiltigt id. Då spårar/prissätter produkten fel vara.
 *
 * Bakgrund: 2026-07-17 hittade ägaren "Red & Blue Collections: Venusaur EX Collection" som
 * länkade till singeln "Surfing Pikachu (WP 28)" och visade DESS pris. Svepet fann 16 sådana
 * LEGACY-länkar (skapade före nuvarande matchningsvakter). cardmarket-refreshens exakt-väg
 * ignorerar redan singel-idProduct (apiByCmId är sealed-only), så INGA NYA skapas — men inget
 * FÅNGADE de gamla. Den här rapporten gör det, gratis och deterministiskt.
 *
 * Fix (manuellt/skript): repeka offern till rätt sealed-idProduct (namnmatcha CM-katalogen),
 * nolla priset (dagliga refreshen prissätter rätt med sina glitch-vakter) och radera den
 * förgiftade CM-historiken. Se [[project-cm-single-link-mismatch]].
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-single-link-report.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-single-link-report.ts --strict   # exit 1 om någon (CI)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STRICT = process.argv.includes("--strict");
const CM_NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] as const;

async function main() {
  const res = await fetch(CM_NONSINGLES_URL);
  if (!res.ok) {
    console.error(`[cm-single-report] kunde inte hämta CM-katalogen: HTTP ${res.status}`);
    process.exit(0); // nätverksfel ska inte bli röd CI
  }
  const catalog = (await res.json()) as { products: { idProduct: number }[] };
  const sealedIds = new Set(catalog.products.map((p) => p.idProduct));

  const offers = await prisma.offer.findMany({
    where: {
      retailer: { name: "Cardmarket" },
      product: { category: { in: [...SEALED] } },
      url: { contains: "idProduct=" },
    },
    select: {
      id: true,
      url: true,
      price: true,
      product: { select: { title: true, slug: true, category: true } },
    },
  });

  const bad = offers
    .map((o) => ({ o, id: Number(o.url.match(/idProduct=(\d+)/)?.[1]) }))
    .filter(({ id }) => id && !sealedIds.has(id));

  console.log(
    `\n=== SEALED CM-OFFERS SOM PEKAR PÅ EN SINGEL/OGILTIGT idProduct — ${bad.length} av ${offers.length} ===`
  );
  if (bad.length === 0) console.log("  Inga. 🎉 (alla sealed-CM-länkar pekar på en sealed-produkt)");
  for (const { o, id } of bad) {
    console.log(`\n  ✗ ${o.product.title}`);
    console.log(`      /produkter/${o.product.slug}  (${o.product.category})`);
    console.log(`      offer=${o.id}  idProduct=${id} (EJ i sealed-katalogen)  pris=${o.price ?? "–"}öre`);
    console.log(`      ${o.url}`);
  }
  if (bad.length > 0) {
    console.log(
      `\n  → Repeka varje offer till rätt sealed-idProduct (namnmatcha CM-katalogen), nolla priset,` +
        `\n    radera CM-historiken. Se [[project-cm-single-link-mismatch]].`
    );
  }

  if (STRICT && bad.length > 0) {
    console.error(`\nSTRICT: ${bad.length} sealed-offers pekar på en singel → exit 1`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
