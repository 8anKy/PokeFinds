/**
 * Rensar fel-matchade butiks-/Tradera-offers på SEALED-produkter (boxar, paket,
 * ETB, bundles m.m.) via KONSENSUS: bland en produkts VISADE (direktlänkade)
 * prissatta offers flaggas de som ligger orimligt under MEDIANEN.
 *
 * Varför median och inte CM-trend som ankare: vissa CM-trendpriser är själva
 * felmappade/uppblåsta (t.ex. Brilliant Stars-box €795 ≈ 8 700 kr). Att ankra
 * på CM skulle då radera ÄKTA billiga svenska butiks-offers. Medianen är robust:
 * när flera butiker är överens hålls de kvar och en ensam felmatchad billig
 * post (t.ex. "Paldea Adventure Chest" 749 kr på en Booster Box för ~2 700 kr)
 * sticker ut och tas bort. Kräver ≥ MIN_OFFERS prissatta offers — annars kan
 * outliern inte avgöras och produkten lämnas orörd.
 *
 * Körs:  npx tsx scripts/clean-sealed-offers.ts            (dry-run)
 *        DELETE=1 npx tsx scripts/clean-sealed-offers.ts   (radera)
 * Env:   FLOOR_RATIO=0.4   (golv som andel av medianen, default 0.40)
 *        MIN_OFFERS=3      (minsta antal prissatta direkt-offers, default 3)
 */
import { PrismaClient } from "@prisma/client";
import { isDirectOfferUrl } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();
const DELETE = process.env.DELETE === "1";
const FLOOR_RATIO = Number(process.env.FLOOR_RATIO ?? "0.4");
const MIN_OFFERS = Number(process.env.MIN_OFFERS ?? "3");

const SEALED_CATS = [
  "BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX",
  "TIN", "BLISTER", "BUNDLE", "OTHER",
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function main() {
  const products = await prisma.product.findMany({
    where: { category: { in: SEALED_CATS as never } },
    select: {
      id: true,
      title: true,
      offers: {
        select: {
          id: true, price: true, url: true,
          retailer: { select: { name: true } },
        },
      },
    },
  });

  let evaluated = 0;
  let flagged = 0;
  const toDelete: string[] = [];

  for (const p of products) {
    const direct = p.offers.filter(
      (o): o is typeof o & { price: number } =>
        o.price != null && o.price > 0 && isDirectOfferUrl(o.url)
    );
    if (direct.length < MIN_OFFERS) continue; // för få för att avgöra outlier
    evaluated++;
    const med = median(direct.map((o) => o.price));
    const floor = Math.round(med * FLOOR_RATIO);

    for (const o of direct) {
      if (o.price < floor) {
        flagged++;
        toDelete.push(o.id);
        if (flagged <= 50) {
          console.log(
            `  ✗ [${o.retailer.name}] ${(o.price / 100).toFixed(0)} kr (< ${(floor / 100).toFixed(0)} kr = ${Math.round(FLOOR_RATIO * 100)}% av median ${(med / 100).toFixed(0)} kr) — "${p.title}"\n      ${o.url}`
          );
        }
      }
    }
  }

  console.log(
    `\nSealed med ≥${MIN_OFFERS} direkt-offers: ${evaluated} | flaggade outliers: ${flagged}`
  );
  if (DELETE && toDelete.length > 0) {
    const res = await prisma.offer.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`🗑️  Raderade ${res.count} offers.`);
  } else if (toDelete.length > 0) {
    console.log("Dry-run — kör med DELETE=1 för att radera.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
