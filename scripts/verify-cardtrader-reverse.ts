/**
 * Efterkontroll av reverse holo-importen. Ren läsning.
 *
 * Svarar på de frågor som avgör om importen blev RÄTT, inte bara STOR:
 *  - Hur många produkter/offers finns, och har de pris?
 *  - Är priset rimligt jämfört med det ORDINARIE kortet? (kvoten vakten dömer på)
 *  - Länkar alla offers till CardTrader, och är URL:en en direktlänk?
 *  - Finns dubbletter (två reverse-produkter på samma kort)?
 *
 *   npx tsx scripts/verify-cardtrader-reverse.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { CT_REVERSE_LABEL } from "../src/lib/cardtrader";
import { isDirectOfferUrl } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.product.count({ where: { variantLabel: CT_REVERSE_LABEL } });
  const withPrice = await prisma.product.count({
    where: { variantLabel: CT_REVERSE_LABEL, lowestPriceOre: { not: null } },
  });
  const retailer = await prisma.retailer.findUnique({
    where: { name: "CardTrader" },
    select: { id: true, name: true, websiteUrl: true, country: true },
  });
  console.log("=".repeat(64));
  console.log(`Reverse holo-produkter:      ${total}`);
  console.log(`  med lowestPriceOre:        ${withPrice}`);
  console.log(`  UTAN pris (göms i katalogen): ${total - withPrice}`);
  console.log(`Retailer: ${JSON.stringify(retailer)}`);

  if (!retailer) {
    await prisma.$disconnect();
    return;
  }
  const offers = await prisma.offer.count({ where: { retailerId: retailer.id } });
  const offersBadUrl = await prisma.offer.count({
    where: { retailerId: retailer.id, NOT: { url: { startsWith: "https://www.cardtrader.com/cards/" } } },
  });
  console.log(`CardTrader-offers:           ${offers}`);
  console.log(`  med oväntad URL:           ${offersBadUrl}`);

  // Dubbletter: fler än en reverse-produkt per kort = fel.
  const dupes = await prisma.$queryRawUnsafe<{ cardId: string; n: bigint }[]>(
    `SELECT "cardId", COUNT(*) n FROM "Product"
     WHERE "variantLabel" = $1 AND "cardId" IS NOT NULL
     GROUP BY "cardId" HAVING COUNT(*) > 1 LIMIT 10`,
    CT_REVERSE_LABEL
  );
  console.log(`Kort med FLER ÄN EN reverse-produkt: ${dupes.length}${dupes.length ? " ⚠" : ""}`);

  // Rimlighet: CARDTRADER-OFFERNS pris mot det ordinarie kortets pris.
  //
  // ⛔ Måste läsa offerns pris, INTE `lowestPriceOre`. Den senare är lägsta
  // priset från VILKEN källa som helst — den pre-existerande Ace Trainer-
  // produkten prissätts av en Tradera-annons, och att jämföra DEN mot baskortet
  // säger ingenting om vakten. Mätt: den enda raden gav "57,58× — över vaktens
  // 50×", vilket såg ut som ett vaktbrott men var en helt annan källa.
  const rows = await prisma.$queryRawUnsafe<{ title: string; rev: number; base: number }[]>(
    `SELECT r."title", o."price" rev, b."lowestPriceOre" base
     FROM "Product" r
     JOIN "Offer" o ON o."productId" = r."id" AND o."retailerId" = $2
     JOIN "Product" b ON b."cardId" = r."cardId" AND b."variantLabel" IS NULL
     WHERE r."variantLabel" = $1 AND o."price" IS NOT NULL
       AND b."lowestPriceOre" IS NOT NULL`,
    CT_REVERSE_LABEL,
    retailer.id
  );
  const ratios = rows.map((r) => r.rev / r.base).sort((a, b) => a - b);
  const q = (p: number) => ratios[Math.floor(ratios.length * p)] ?? 0;
  console.log(`\nKvot CardTrader-reverse / VÅRT baspris (${rows.length} par) — INFORMATIVT:`);
  console.log(`  min ${q(0).toFixed(2)}× · median ${q(0.5).toFixed(2)}× · p90 ${q(0.9).toFixed(2)}× · max ${q(0.999).toFixed(2)}×`);
  console.log(`  billigare än ordinarie: ${ratios.filter((r) => r < 1).length} (${((ratios.filter((r) => r < 1).length / Math.max(1, ratios.length)) * 100).toFixed(1)} %)`);
  console.log(`  över 50×:               ${ratios.filter((r) => r > 50).length}`);
  console.log(
    `  ⚠ Detta är INTE vaktens kvot och ska INTE vara noll. Vakten dömer mot\n` +
      `    CardTraders EGET ordinarie golv; det här är mot Cardmarkets. De två\n` +
      `    marknadsplatserna har olika prisgolv — MÄTT på Temporal Forces Metang:\n` +
      `    CardTrader 0,18 € mot Cardmarket 0,02 €, dvs kvoten blir 47× respektive\n` +
      `    424× för SAMMA annons. Höga tal här betyder att baskortet ligger på\n` +
      `    Cardmarkets minimipris (0,22 kr), inte att vakten släppt igenom något.`
  );

  const sample = await prisma.product.findMany({
    where: { variantLabel: CT_REVERSE_LABEL, lowestPriceOre: { not: null } },
    select: {
      title: true,
      slug: true,
      lowestPriceOre: true,
      offers: { select: { url: true, price: true, stockStatus: true, retailer: { select: { name: true } } } },
    },
    orderBy: { lowestPriceOre: "desc" },
    take: 5,
  });
  console.log(`\nDyraste 5:`);
  for (const s of sample) {
    const o = s.offers[0];
    console.log(`  ${((s.lowestPriceOre ?? 0) / 100).toFixed(2).padStart(10)} kr  ${s.title.slice(0, 46)}`);
    console.log(`     /${s.slug}`);
    console.log(`     ${o?.retailer.name} · ${o?.stockStatus} · direktlänk=${isDirectOfferUrl(o?.url)} · ${o?.url}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
