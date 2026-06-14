/**
 * Uppdaterar Cardmarket-offers för sealed-produkter som matchats mot CM:s
 * katalog: exakt produktsida via officiellt idProduct
 * (/en/Pokemon/Products?idProduct={id}&language=1 — redirecten bevarar
 * query-parametrar, language=1 förfiltrerar annonserna till engelska).
 * Kör: npx tsx --env-file=.env scripts/fix-cm-sealed-urls.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { cardmarketProductUrl } from "./marketplace-urls";

const prisma = new PrismaClient();

async function main() {
  const cm = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });
  const { matched } = JSON.parse(
    readFileSync(".cache/cardmarket/matched-products.json", "utf8")
  ) as { matched: { productId: string; idProduct: number; cmName: string }[] };

  let updated = 0;
  for (const m of matched) {
    const res = await prisma.offer.updateMany({
      where: { productId: m.productId, retailerId: cm.id },
      data: { url: cardmarketProductUrl(m.idProduct) },
    });
    updated += res.count;
  }
  console.log(`✅ ${updated} Cardmarket-offers fick exakt produkt-URL via idProduct (${matched.length} matchade produkter)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
