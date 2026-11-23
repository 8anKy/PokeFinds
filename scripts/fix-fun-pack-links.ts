/**
 * FELKOPPLADE BUTIKSLÄNKAR PÅ FUN PACKS (2026-11-23).
 *
 * "Fun Pack (3 Cards)" var formlös i matchningen och blev setets magnet: checklane-blistrar,
 * 3-pack-blistrar och en tin kopplades dit (se classifyForm → "funpack"). Matchningen är lagad,
 * men en bunden URL är identiteten — nattkedjan rör aldrig en redan kopplad rad. Det här skriptet
 * prövar om varje butiksoffer på en fun pack mot dagens matchning:
 *   BEHÅLL  — annonsen ÄR en fun pack
 *   FLYTTA  — annonsen hör till en annan katalogprodukt (butiken har ingen offer där ännu)
 *   TA BORT — ingen säker produkt (eller butiken har redan en offer på den rätta) ⇒ offern raderas
 *             och butikssidans koppling nollas, så sidan prövas om när katalogen växer
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-fun-pack-links.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-fun-pack-links.ts --apply
 */
import { prisma } from "../src/lib/db";
import { classifyForm, loadMatchIndex, matchProduct } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");
const NOT_STORES = ["Cardmarket", "Tradera", "CardTrader"];

async function main() {
  const index = await loadMatchIndex({ visibleOnly: true });
  const products = (
    await prisma.product.findMany({
      where: { game: "POKEMON", category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
      select: { id: true, title: true },
    })
  ).filter((p) => classifyForm(p.title) === "funpack");
  const titleById = new Map((await prisma.product.findMany({ where: { id: { in: index.map((i) => i.id) } }, select: { id: true, title: true } })).map((p) => [p.id, p.title]));
  const offers = await prisma.offer.findMany({
    where: { productId: { in: products.map((p) => p.id) }, retailer: { name: { notIn: NOT_STORES } } },
    select: { id: true, url: true, price: true, stockStatus: true, condition: true, language: true, productId: true, retailerId: true, retailer: { select: { name: true } }, product: { select: { title: true } } },
  });
  const touched = new Set<string>();
  let keep = 0, move = 0, drop = 0;
  for (const o of offers) {
    const listing = await prisma.storeListing.findFirst({ where: { retailerId: o.retailerId, url: o.url }, select: { id: true, title: true } });
    // Utan sparad butikstitel är URL:ens sista led det närmaste butikens eget namn på varan.
    const title = listing?.title?.trim() || decodeURIComponent(o.url.split("?")[0].replace(/\/$/, "").split("/").pop() ?? "").replace(/^\d+-/, "").replace(/-/g, " ");
    const m = await matchProduct(normalizeTitle(title), index, title);
    const kr = o.price != null ? `${Math.round(o.price / 100)} kr` : "–";
    const line = `${o.retailer.name.padEnd(14)} ${kr.padStart(7)}  "${title.slice(0, 62)}"`;
    if (m?.productId === o.productId) {
      keep++;
      console.log(`BEHÅLL   ${line}`);
      continue;
    }
    const clash = m
      ? await prisma.offer.findFirst({ where: { productId: m.productId, retailerId: o.retailerId, condition: o.condition, language: o.language }, select: { id: true } })
      : null;
    if (m && !clash) {
      move++;
      console.log(`FLYTTA   ${line}\n           ${o.product.title}  →  ${titleById.get(m.productId) ?? m.productId}`);
      if (APPLY) {
        await prisma.offer.update({ where: { id: o.id }, data: { productId: m.productId } });
        if (listing) await prisma.storeListing.update({ where: { id: listing.id }, data: { productId: m.productId } });
        touched.add(m.productId);
      }
    } else {
      drop++;
      console.log(`TA BORT  ${line}\n           från ${o.product.title}${m ? `  (rätt produkt ${titleById.get(m.productId)} har redan butikens offer)` : "  (ingen säker produkt)"}`);
      if (APPLY) {
        await prisma.offer.delete({ where: { id: o.id } });
        if (listing) await prisma.storeListing.update({ where: { id: listing.id }, data: { productId: m?.productId ?? null, productMatchTitle: null } });
      }
    }
    touched.add(o.productId);
  }
  console.log(`\n${offers.length} butiksoffers på ${products.length} fun pack-produkter: behåll ${keep} · flytta ${move} · ta bort ${drop}.${APPLY ? "" : "  (TORRKÖRNING — inget skrivet)"}`);
  if (APPLY && touched.size) {
    await recomputeProductPriceCache();
    console.log(`Priscachen omräknad (${touched.size} produkter berörda).`);
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
