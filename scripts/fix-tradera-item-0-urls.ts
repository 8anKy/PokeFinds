/**
 * RÄTTAR DE TRASIGA TRADERA-LÄNKARNA `/item/0/<id>` → `/item/<id>`.
 *
 * ⛔ `/item/0/<id>` ÄR 404 (mätt mot tradera.com 2026-09-07). Kategorisegmentet
 * 0 var påhittat och Traderas kanoniska form kräver BÅDE rätt kategori och en
 * slug — men den KORTA formen `/item/<id>` kanoniseras av Tradera själva med en
 * 308. Koden bygger länken med `traderaItemUrl()` sedan samma dag; det här
 * skriptet lagar raderna som redan ligger i databasen.
 *
 * Träffar: `CommunityPost.traderaUrl` (forumets annonser — det var här ägaren
 * såg felet), `Offer.url` (katalogens Tradera-priser), `TraderaListing.url` och
 * `GradedSale.url`.
 *
 * ⛔ Rör BARA rader vars URL matchar `/item/0/<siffror>`. En riktig annons-URL
 * med kategori och slug är redan giltig och ska aldrig skrivas om.
 *
 * Rapport:  node scripts/with-prod-db.mjs npx tsx scripts/fix-tradera-item-0-urls.ts
 * Verkställ: … scripts/fix-tradera-item-0-urls.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { traderaItemUrl } from "@/lib/tradera-listing-options";

const APPLY = process.argv.includes("--apply");

/** `https://www.tradera.com/item/0/749317922/` → `https://www.tradera.com/item/749317922` */
function repair(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?tradera\.com\/item\/0\/(\d+)\/?$/i);
  return m ? traderaItemUrl(m[1]) : null;
}

async function fixTable(
  label: string,
  rows: { id: string; url: string }[],
  update: (id: string, url: string) => Promise<unknown>
) {
  let fixed = 0;
  for (const row of rows) {
    const next = repair(row.url);
    if (!next) continue;
    fixed++;
    if (APPLY) await update(row.id, next);
    else if (fixed <= 5) console.log(`   ${row.url}  →  ${next}`);
  }
  console.log(`${label}: ${fixed} av ${rows.length} trasiga${APPLY ? " — rättade" : ""}`);
  return fixed;
}

async function main() {
  console.log(APPLY ? "VERKSTÄLLER" : "TORRKÖRNING (--apply för att skriva)");

  const posts = await prisma.communityPost.findMany({
    where: { traderaUrl: { contains: "/item/0/" } },
    select: { id: true, traderaUrl: true },
  });
  const offers = await prisma.offer.findMany({
    where: { url: { contains: "/item/0/" } },
    select: { id: true, url: true },
  });
  const listings = await prisma.traderaListing.findMany({
    where: { url: { contains: "/item/0/" } },
    select: { id: true, url: true },
  });
  const sales = await prisma.gradedSale.findMany({
    where: { url: { contains: "/item/0/" } },
    select: { id: true, url: true },
  });

  const total =
    (await fixTable(
      "CommunityPost.traderaUrl",
      posts.map((p) => ({ id: p.id, url: p.traderaUrl! })),
      (id, url) => prisma.communityPost.update({ where: { id }, data: { traderaUrl: url } })
    )) +
    (await fixTable("Offer.url", offers, (id, url) =>
      prisma.offer.update({ where: { id }, data: { url } })
    )) +
    (await fixTable("TraderaListing.url", listings, (id, url) =>
      prisma.traderaListing.update({ where: { id }, data: { url } })
    )) +
    (await fixTable("GradedSale.url", sales, (id, url) =>
      prisma.gradedSale.update({ where: { id }, data: { url } })
    ));

  console.log(`\nTotalt: ${total}${APPLY ? " rättade" : " att rätta"}`);
  await prisma.$disconnect();
}

void main();
