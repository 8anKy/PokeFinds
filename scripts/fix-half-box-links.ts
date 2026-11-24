/**
 * HALVBOXAR (18 boosters) KOPPLADE TILL HELA BOOSTERBOXEN (2026-11-24, användaranmälningar).
 *
 * Butikerna kallar 18-lådan "Half Booster Box" / "Half Display" utan att skriva ut antalet, och
 * `boosterBoxCountMismatch` kände bara siffror ⇒ halvboxen landade på 36-boxen: TCG Stores à 1 299 kr
 * stod som LÄGSTA PRIS på Chaos Rising Booster Box. Vakten är lagad (matching.ts), men en bunden URL
 * är identiteten — nattkedjan rör aldrig en redan kopplad rad. Det här skriptet flyttar dem:
 *   FLYTTA — setets "(18 Boosters)"-produkt finns och butiken har ingen offer där ännu
 *   KROCK  — butiken har redan en offer på 18-produkten ⇒ rapporteras, rörs inte
 *   SAKNAS — setet har ingen 18-produkt ⇒ rapporteras, rörs inte
 *   OSÄKER — butikens titel nämner inte produktens set (felskriven annons) ⇒ rapporteras, rörs inte
 * Ingenting raderas.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-half-box-links.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-half-box-links.ts --apply
 */
import { prisma } from "../src/lib/db";
import { recomputeProductPriceCache } from "../src/services/products";
import { exitJob } from "../src/lib/job-exit";

const APPLY = process.argv.includes("--apply");
const NOT_STORES = ["Cardmarket", "Tradera", "CardTrader"];
const HALF = /\b(?:half|halv)[\s-]*(?:booster[\s-]*)?(?:box|display)\b|\bhalv(?:box|display)\b/i;
const IS_18 = /\(18 Boosters\)/i;

async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: { notIn: NOT_STORES } }, product: { category: "BOOSTER_BOX", game: "POKEMON" } },
    select: {
      id: true, url: true, price: true, stockStatus: true, condition: true, language: true, retailerId: true,
      retailer: { select: { name: true } },
      product: { select: { id: true, title: true, setId: true, language: true, set: { select: { name: true } } } },
    },
  });
  let move = 0, clash = 0, missing = 0, unsure = 0;
  for (const o of offers) {
    if (IS_18.test(o.product.title)) continue;
    const listing = await prisma.storeListing.findFirst({ where: { retailerId: o.retailerId, url: o.url }, select: { title: true } });
    const text = `${listing?.title ?? ""} ${decodeURIComponent(o.url).replace(/[-_/]+/g, " ")}`;
    if (!HALF.test(text)) continue;
    const price = o.price != null ? `${o.price / 100} kr` : "–";
    // Butikens text måste nämna produktens SET — annars vet vi inte vilken halvbox det är.
    const setWords = (o.product.set?.name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (!setWords.length || !setWords.every((w) => text.toLowerCase().includes(w))) {
      unsure++;
      console.log(`OSÄKER  ${o.retailer.name} ${price} ${o.stockStatus} "${listing?.title ?? o.url}" står på "${o.product.title}" — setnamnet står inte i annonsen`);
      continue;
    }
    const targets = o.product.setId
      ? await prisma.product.findMany({
          where: { setId: o.product.setId, category: "BOOSTER_BOX", language: o.product.language, hiddenAt: null, title: { contains: "(18 Boosters)" } },
          select: { id: true, title: true },
        })
      : [];
    if (targets.length !== 1) {
      missing++;
      console.log(`SAKNAS  ${o.retailer.name} ${price} ${o.stockStatus} "${listing?.title ?? o.url}" står på "${o.product.title}" — setet har ${targets.length} 18-produkter`);
      continue;
    }
    const target = targets[0];
    const taken = await prisma.offer.findFirst({ where: { productId: target.id, retailerId: o.retailerId, condition: o.condition, language: o.language }, select: { id: true } });
    if (taken) {
      clash++;
      console.log(`KROCK   ${o.retailer.name} ${price} "${listing?.title ?? o.url}" — butiken har redan en offer på "${target.title}"`);
      continue;
    }
    move++;
    console.log(`FLYTTA  ${o.retailer.name} ${price} ${o.stockStatus} "${listing?.title ?? o.url}": "${o.product.title}" → "${target.title}"`);
    if (!APPLY) continue;
    await prisma.offer.update({ where: { id: o.id }, data: { productId: target.id } });
    await prisma.storeListing.updateMany({ where: { retailerId: o.retailerId, url: o.url }, data: { productId: target.id } });
  }
  console.log(`\n${APPLY ? "Flyttade" : "Skulle flytta"} ${move} · krockar ${clash} · saknar 18-produkt ${missing} · osäkra ${unsure}`);
  if (APPLY && move > 0) {
    await recomputeProductPriceCache();
    console.log("Priscachen omräknad.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
