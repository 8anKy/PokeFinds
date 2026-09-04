/**
 * STÄDNING: ta bort GRADERADE Tradera-rader som ligger på RÅA produkter.
 *
 * Bakgrund: `isGradedListing` (src/lib/graded-listing.ts) sattes in i parsern
 * 2026-09-04 så att slabbar aldrig mer blir offers, skena-rader eller
 * prisobservationer på det ograderade kortet. Vakten gäller FRAMÅT — de rader som
 * redan skrevs ligger kvar. MÄTT samma dag i produktionen: 16 aktiva offers,
 * 21 skena-rader och 591 prisobservationer, bl.a. en CGC 6 för 30 000 kr som
 * "lägsta pris" på ett löskort.
 *
 * ⛔ DRY RUN SOM DEFAULT. `--apply` krävs för att radera. (gtin-fixen 2026-08-17
 * raderade riktiga produkter för att `--apply` satt i ett schemalagt jobb — den
 * här körs för hand, en gång, och rapporten läses FÖRE.)
 *
 * ⛔ DOMEN TAS AV SAMMA FUNKTION SOM VAKTEN. En städning med sin egen regex hade
 * kunnat radera rader som vakten släpper igenom, och tvärtom.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-graded-from-raw.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-graded-from-raw.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { detectGrading, isGradedListing } from "../src/lib/graded-listing";
import { recomputeProductPriceCache } from "../src/services/products";
import { listingCardLanguage } from "../src/lib/listing-language";

const APPLY = process.argv.includes("--apply");

/**
 * Tradera-slugen ÄR titeln, gemen och bindestrecksseparerad:
 * `/item/1001337/745638161/latias-latios-gx-170-181-team-up-pokemonkort-cgc-6`.
 * Den görs om till en mening så att exakt samma vakt kan döma den.
 */
function titleFromTraderaUrl(url: string): string {
  const slug = url.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(slug).replace(/-/g, " ");
  } catch {
    return slug.replace(/-/g, " ");
  }
}

function kr(ore: number | null): string {
  return ore == null ? "–" : `${Math.round(ore / 100)} kr`;
}

async function main() {
  console.log(APPLY ? "⚠️  APPLY — rader raderas\n" : "🔍 DRY RUN — inget raderas (kör med --apply)\n");

  // ── 1. Offers ──────────────────────────────────────────────────────────────
  const retailers = await prisma.retailer.findMany({
    where: { name: { contains: "Tradera", mode: "insensitive" } },
    select: { id: true },
  });
  const offers = await prisma.offer.findMany({
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    select: { id: true, url: true, price: true, productId: true, product: { select: { title: true, category: true } } },
  });
  const badOffers = offers.filter((o) => {
    if (o.product.category === "GRADED_CARD") return false;
    // Annonsens EGEN kategori i URL:en — 1001338 = Graderade kort.
    if (/\/item\/1001338\//.test(o.url)) return true;
    return isGradedListing({ title: titleFromTraderaUrl(o.url) });
  });
  console.log(`=== OFFERS: ${badOffers.length} av ${offers.length} är graderade på en RÅ produkt ===`);
  for (const o of badOffers) {
    const g = detectGrading({ title: titleFromTraderaUrl(o.url) });
    console.log(`  ${kr(o.price).padStart(9)}  ${(g ? `${g.issuer} ${g.gradeTenths ? g.gradeTenths / 10 : "?"}` : "?").padEnd(14)} ${o.product.title.slice(0, 48)}`);
  }

  // ── 2. Skena-rader ("Fler annonser på Tradera") ────────────────────────────
  const rails = await prisma.traderaListing.findMany({
    select: { id: true, title: true, price: true, url: true, product: { select: { title: true, category: true } } },
  });
  const badRails = rails.filter(
    (r) => r.product.category !== "GRADED_CARD" && isGradedListing({ title: r.title })
  );
  console.log(`\n=== SKENA-RADER: ${badRails.length} av ${rails.length} ===`);
  for (const r of badRails.slice(0, 25)) {
    console.log(`  ${kr(r.price).padStart(9)}  ${r.title.slice(0, 62)}`);
  }
  if (badRails.length > 25) console.log(`  … och ${badRails.length - 25} till`);

  // ── 3. Prisobservationer (annonskurvan + sålt-kurvan) ──────────────────────
  const sources = await prisma.scrapeSource.findMany({
    where: { name: { contains: "Tradera", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  interface BadObs {
    id: string;
    title: string;
    price: number;
    source: string;
    /** Sant för "Tradera sålt" — då är raden en RIKTIG affär och ska FLYTTAS, inte kastas. */
    isSold: boolean;
    productId: string;
    itemId: string | null;
    url: string | null;
    observedAt: Date;
    bidCount: number | null;
  }
  const badObs: BadObs[] = [];
  for (const s of sources) {
    const rows = await prisma.$queryRawUnsafe<
      {
        id: string;
        title: string | null;
        price: number;
        category: string;
        productid: string;
        itemid: string | null;
        url: string | null;
        observedat: Date;
        bidcount: string | null;
      }[]
    >(
      `SELECT o.id, o."rawData"->>'title' AS title, o.price, p.category,
              o."productId" AS productid, o."rawData"->>'itemId' AS itemid,
              o."rawData"->>'url' AS url, o."observedAt" AS observedat,
              o."rawData"->>'bidCount' AS bidcount
       FROM "PriceObservation" o JOIN "Product" p ON p.id = o."productId"
       WHERE o."sourceId" = $1 AND o."rawData"->>'title' IS NOT NULL`,
      s.id
    );
    for (const r of rows) {
      if (r.category === "GRADED_CARD") continue;
      if (!r.title || !isGradedListing({ title: r.title })) continue;
      badObs.push({
        id: r.id,
        title: r.title,
        price: r.price,
        source: s.name,
        isSold: /sålt/i.test(s.name),
        productId: r.productid,
        itemId: r.itemid,
        url: r.url,
        observedAt: r.observedat,
        bidCount: r.bidcount != null ? parseInt(r.bidcount, 10) : null,
      });
    }
  }
  // ⛔ SÅLT-RADERNA KASTAS INTE. De är riktiga affärer vi redan samlat in — bara
  // arkiverade i fel låda. De FLYTTAS till `GradedSale` och blir seriens
  // startkapital. (Det är inte en backfill ur en främmande källa; det är vår egen
  // insamlade data som byter tabell.) Annonsraderna ("Tradera") är begärda priser
  // på en rå produkt och har inget hem — de raderas.
  const toMove = badObs.filter((o) => o.isSold && o.itemId && o.url);
  const toDelete = badObs;
  console.log(`\n=== PRISOBSERVATIONER: ${badObs.length} (${toMove.length} sålda FLYTTAS till GradedSale) ===`);
  for (const o of badObs.slice(0, 20)) {
    console.log(`  ${kr(o.price).padStart(9)}  ${o.isSold ? "→FLYTT" : "→RADERA"} [${o.source}] ${o.title.slice(0, 50)}`);
  }
  if (badObs.length > 20) console.log(`  … och ${badObs.length - 20} till`);

  if (!APPLY) {
    console.log("\n🔍 DRY RUN — inget raderades. Kör om med --apply när listan ser rätt ut.");
    await prisma.$disconnect();
    return;
  }

  // FLYTTA FÖRST, radera sedan — kraschar flytten halvvägs är affärerna kvar i
  // sin gamla tabell och körningen kan göras om. Omvänd ordning hade tappat dem.
  let moved = 0;
  for (const o of toMove) {
    const g = detectGrading({ title: o.title });
    if (!g) continue;
    await prisma.gradedSale.upsert({
      where: { itemId: o.itemId! },
      update: {},
      create: {
        productId: o.productId,
        itemId: o.itemId!,
        issuer: g.issuer,
        gradeTenths: g.gradeTenths,
        price: o.price,
        currency: "SEK",
        language: listingCardLanguage(o.title, o.url),
        title: o.title,
        url: o.url!,
        soldAt: o.observedAt,
        bidCount: o.bidCount,
        // Raden kommer ur sålt-svepet, som redan bevisat affären.
        verify: "migrated",
        source: "tradera",
      },
    });
    moved++;
  }
  console.log(`\n📦 Flyttade ${moved} sålda graderade affärer till GradedSale.`);

  const delOffers = await prisma.offer.deleteMany({ where: { id: { in: badOffers.map((o) => o.id) } } });
  const delRails = await prisma.traderaListing.deleteMany({ where: { id: { in: badRails.map((r) => r.id) } } });
  const delObs = await prisma.priceObservation.deleteMany({ where: { id: { in: toDelete.map((o) => o.id) } } });
  console.log(`🗑️  Raderade ${delOffers.count} offers, ${delRails.count} skena-rader, ${delObs.count} observationer`);

  // Produkternas cachade lägstapris pekade på de raderade offerterna.
  await recomputeProductPriceCache();
  console.log("♻️  lowestPriceOre omräknat.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
