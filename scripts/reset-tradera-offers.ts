/**
 * Återställer Tradera-offers inför omkörning med officiella API:t.
 *
 * Den gamla HTML-skraparen matchade fel (t.ex. "5 x boosterpaket" → Booster
 * Bundle) — därför:
 *  1. Alla prissatta Tradera-offers (och offers med exakta /item/-URL:er)
 *     nollas till ärliga länk-offers: price=null, sök-URL, status UNKNOWN.
 *  2. Alla PriceObservations från källan "Tradera" raderas (skapade med den
 *     buggiga matchningen; prishistoriken är ändå Cardmarket-only).
 *  3. RestockEvents för Tradera-butiken raderas (genererade av felmatchningar).
 *
 * Förbättrar samtidigt sök-URL:en för sealed-produkter som matchats mot
 * Cardmarkets katalog: CM:s officiella produktnamn ("Ascended Heroes Booster
 * Bundle") ger mer precisa Tradera-/CM-sökningar än våra långa titlar.
 *
 * Dry-run som standard. Kör skarpt med: APPLY=1 npx tsx scripts/reset-tradera-offers.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { traderaSearchUrl } from "./marketplace-urls";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

function searchTerm(title: string): string {
  return title.replace(/\s*·\s*/g, " ").trim();
}

async function main() {
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });

  // CM-katalognamn per productId (mer precisa söktermer för sealed)
  let cmNames = new Map<string, string>();
  try {
    const matched = JSON.parse(
      readFileSync(".cache/cardmarket/matched-products.json", "utf8")
    ) as { matched: { productId: string; cmName: string }[] };
    cmNames = new Map(matched.matched.map((m) => [m.productId, m.cmName]));
  } catch {
    console.log("(matched-products.json saknas — använder produkttitlar)");
  }

  const offers = await prisma.offer.findMany({
    where: {
      retailerId: tradera.id,
      OR: [{ price: { not: null } }, { url: { contains: "/item/" } }],
    },
    select: { id: true, price: true, url: true, product: { select: { id: true, title: true } } },
  });
  console.log(`Tradera-offers att nolla: ${offers.length}`);
  for (const o of offers.slice(0, 10)) {
    console.log(`  ${o.product.title.slice(0, 60)} | ${o.price === null ? "länk" : o.price / 100 + " kr"} | ${o.url.slice(0, 80)}`);
  }

  const obsCount = await prisma.priceObservation.count({
    where: { source: { name: "Tradera" } },
  });
  const restockCount = await prisma.restockEvent.count({
    where: { retailerId: tradera.id },
  });
  console.log(`Tradera-observationer att radera: ${obsCount}`);
  console.log(`Tradera-restockhändelser att radera: ${restockCount}`);

  if (!APPLY) {
    console.log("\nDry-run. Kör skarpt med APPLY=1.");
    return;
  }

  for (const o of offers) {
    const term = cmNames.get(o.product.id) ?? searchTerm(o.product.title);
    await prisma.offer.update({
      where: { id: o.id },
      data: {
        price: null,
        url: traderaSearchUrl(term),
        stockStatus: "UNKNOWN",
        shippingPrice: null,
      },
    });
  }
  const delObs = await prisma.priceObservation.deleteMany({
    where: { source: { name: "Tradera" } },
  });
  const delRestock = await prisma.restockEvent.deleteMany({
    where: { retailerId: tradera.id },
  });
  console.log(`\n✅ ${offers.length} offers nollade, ${delObs.count} observationer + ${delRestock.count} restockhändelser raderade.`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
