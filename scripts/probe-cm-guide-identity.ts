/**
 * Kontrollerar att en idProduct betyder SAMMA kort i CM:s officiella singel-katalog,
 * i CM:s officiella prisguide och i RapidAPI. Alla tre är publika exporter/API —
 * ingen scraping av cardmarket.com.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-cm-guide-identity.ts 291582 280224 274058 275232
 */
const SINGLES_URL = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

const IDS = process.argv.slice(2).map(Number).filter(Boolean);

async function main() {
  const [sRes, gRes] = await Promise.all([fetch(SINGLES_URL), fetch(GUIDE_URL)]);
  const singles = (await sRes.json()) as { products: Record<string, unknown>[] };
  const guide = (await gRes.json()) as { priceGuides: Record<string, number>[] };
  console.log(`Officiell singel-katalog: ${singles.products.length} produkter`);
  console.log(`Officiell prisguide:      ${guide.priceGuides.length} rader`);
  console.log(`Katalogens fält: ${JSON.stringify(Object.keys(singles.products[0]))}\n`);

  const byId = new Map(singles.products.map((p) => [Number(p.idProduct), p]));
  const gById = new Map(guide.priceGuides.map((e) => [Number(e.idProduct), e]));

  for (const id of IDS) {
    const p = byId.get(id);
    const g = gById.get(id);
    console.log(`idProduct=${id}`);
    console.log(`  katalog:  ${p ? JSON.stringify(p) : "SAKNAS"}`);
    console.log(`  guide:    ${g ? JSON.stringify(g) : "SAKNAS"}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
