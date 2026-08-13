/**
 * RENSAR PRODUKTER SOM BARA LEVER PÅ NEKADE BUTIKS-URL:er.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-denylisted-products.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-denylisted-products.ts --apply
 *
 * VARFÖR DEN BEHÖVS — KAPPLÖPNINGEN (2026-08-13). Att denylista en URL hindrar
 * FRAMTIDA import, men säger ingenting om rader som redan finns. Och mellan att en
 * produkt raderas och att denylistan når Actions-lanan finns ett fönster: skraparen
 * kör var 10:e minut och checkar ut repot när den STARTAR, så en körning som började
 * före pushen kör med den gamla listan och återskapar precis det som nyss togs bort.
 * Mätt: 43 produkter återuppstod 20:55–20:58 medan omgång 3 verkställdes.
 *
 * REGELN ÄR EN REN SLUTSATS, INGEN GISSNING: en produkt vars SAMTLIGA butiks-URL:er
 * är nekade kan inte längre uppdateras av någon feed. Denylistan säger uttryckligen
 * att de URL:erna inte får skapa produkter — då ska de inte hålla en produkt vid liv
 * heller. Kör den efter varje städomgång; hittar den inget är katalogen ren.
 *
 * ⛔ KRÄVER MINST EN BUTIKS-OFFER. En produkt utan butiksoffers (bara Cardmarket/
 *    Tradera, eller helt utan offers) faller INTE in under regeln — den är katalogens
 *    egen rad, inte en butiksimporterad stub, och "noll av noll är nekade" är sant
 *    men betyder ingenting.
 * ⛔ RÖR ALDRIG en produkt med prishistorik, bevakning eller samlingspost utan
 *    `--force`: en kanonisk produkt kan ha råkat få alla sina butikslänkar nekade,
 *    och den ska granskas, inte raderas.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { isDeniedListingUrl } from "../src/scrapers/import-denylist";
import { isStoreRetailer } from "../src/lib/offer-source";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  console.log(`DB: ${db} — ${APPLY ? "APPLY (raderar)" : "TORRKÖRNING"}\n`);

  const products = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true,
      slug: true,
      title: true,
      createdAt: true,
      offers: { select: { url: true, retailer: { select: { name: true } } } },
      _count: { select: { priceSnapshots: true, watchlistItems: true, collectionItems: true } },
    },
  });

  const doomed: typeof products = [];
  const held: typeof products = [];
  for (const p of products) {
    const storeUrls = p.offers.filter((o) => o.url && isStoreRetailer(o.retailer.name));
    if (storeUrls.length === 0) continue; // ingen butiksförankring → inte vår regel
    if (!storeUrls.every((o) => isDeniedListingUrl(o.url!))) continue;
    const precious = p._count.watchlistItems + p._count.collectionItems > 0 || p._count.priceSnapshots > 1;
    (precious && !FORCE ? held : doomed).push(p);
  }

  console.log(`${doomed.length} produkter lever bara på nekade butiks-URL:er.`);
  for (const p of doomed.slice(0, 30)) {
    console.log(`  ${p.createdAt.toISOString().slice(0, 16)}  ${p.title}`);
    console.log(`     ${p.slug}`);
  }
  if (doomed.length > 30) console.log(`  … ${doomed.length - 30} till`);

  if (held.length) {
    console.log(`\n⚠ ${held.length} hoppas över — de har historik/bevakning/samling och kräver --force:`);
    for (const p of held) {
      console.log(
        `   [${p._count.priceSnapshots} snap, ${p._count.watchlistItems} bev, ${p._count.collectionItems} saml] ${p.title}`
      );
    }
  }

  if (!APPLY) {
    console.log(`\nTORRKÖRNING — inget raderat. --apply för att radera.`);
    return;
  }
  if (doomed.length === 0) return;
  const { count } = await prisma.product.deleteMany({ where: { id: { in: doomed.map((p) => p.id) } } });
  console.log(`\n🗑  ${count} produkter raderade. De kan inte återskapas — URL:erna är nekade.`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
