/**
 * Backfill: hämtar tillverkarens streckkod för BEFINTLIGA sealed-offers och skriver
 * den till Offer.gtin (+ Product.gtin när produkten saknar kod och dess offers är eniga).
 *
 * Efter detta blir wrong-link-detektorn ren SQL (scripts/gtin-report.ts): två offers på
 * samma produkt med OLIKA streckkod = bevisad felaktig butikslänk, noll LLM-tokens.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-gtin.ts --dry
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-gtin.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-gtin.ts --store "Dragon's Lair" --limit 200
 *
 * Resumerbar: hoppar över offers som redan har gtin. Kör om tills --dry visar 0 kvar.
 * Kör dagligen i scrape-all för nya offers (--limit räcker; de flesta är redan ifyllda).
 */
import { PrismaClient } from "@prisma/client";
import { fetchListingGtin, STORE_GTIN_STRATEGY } from "../src/scrapers/gtin-source";
import { formatGtin } from "../src/lib/gtin";
import { mapPool } from "../src/lib/concurrency";

const prisma = new PrismaClient();

const has = (f: string) => process.argv.includes(f);
const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = has("--dry");
const LIMIT = Number(arg("--limit") ?? 5000);
const ONLY_STORE = arg("--store");
const CONCURRENCY = 3;

const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] as const;

async function main() {
  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const targets = retailers
    .filter((r) => (STORE_GTIN_STRATEGY[r.name] ?? "none") !== "none")
    .filter((r) => !ONLY_STORE || r.name === ONLY_STORE);

  console.log(`${DRY ? "[DRY-RUN] " : ""}Backfill GTIN för: ${targets.map((t) => t.name).join(", ")}\n`);

  // ---- SJÄLVLÄKNING: rensa koder från butiker som stängts av ----
  // Sätts en butik till "none" (t.ex. Spelexperten, som visade sig HITTA PÅ streckkoder
  // med giltig checksiffra) måste dess redan sparade koder bort — annars lever de kvar
  // och skapar falska konflikter som blockerar korrekta merges. Körs varje gång, gratis.
  const banned = retailers.filter((r) => (STORE_GTIN_STRATEGY[r.name] ?? "none") === "none");
  if (banned.length > 0 && !DRY) {
    const purged = await prisma.offer.updateMany({
      where: { retailerId: { in: banned.map((b) => b.id) }, gtin: { not: null } },
      data: { gtin: null },
    });
    if (purged.count > 0) {
      console.log(`Rensade ${purged.count} streckkoder från avstängda butiker (${banned.map((b) => b.name).join(", ")}).\n`);
    }
  }

  let fetched = 0;
  let written = 0;
  let missing = 0;

  for (const retailer of targets) {
    // Bara offers som SAKNAR kod → skriptet är resumerbart och billigt att köra om.
    const offers = await prisma.offer.findMany({
      where: {
        retailerId: retailer.id,
        gtin: null,
        product: { category: { in: [...SEALED] } },
      },
      select: { id: true, url: true, productId: true, product: { select: { title: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: LIMIT,
    });
    if (offers.length === 0) {
      console.log(`${retailer.name.padEnd(15)} — inga offers utan gtin. Klar.`);
      continue;
    }

    let storeHits = 0;
    await mapPool(offers, CONCURRENCY, async (offer) => {
      const gtin = await fetchListingGtin(retailer.name, offer.url);
      fetched++;
      if (!gtin) {
        missing++;
        return;
      }
      storeHits++;
      if (DRY) return;
      await prisma.offer.update({ where: { id: offer.id }, data: { gtin } });
      written++;
    });

    console.log(
      `${retailer.name.padEnd(15)} offers=${String(offers.length).padStart(4)}  ` +
        `GTIN hittad=${String(storeHits).padStart(4)} (${Math.round((storeHits / offers.length) * 100)}%)`
    );
  }

  console.log(`\nHämtade ${fetched} sidor · ${DRY ? "skulle skriva" : "skrev"} ${DRY ? fetched - missing : written} offer-koder · ${missing} saknade kod.`);

  // ---- Product.gtin: sätt BARA när produktens offers är ENIGA ----
  // Är de oeniga har produkten en felaktig butikslänk — den ska REVIEWAS, inte tystas
  // genom att vi väljer en kod på måfå. gtin-report.ts listar dem.
  if (!DRY) {
    console.log(`\nRäknar om Product.gtin från offer-konsensus…`);
    // Nollställ FÖRST: en produkt kan ha fått sin kod från en butik som sedan stängts av
    // (påhittade koder). Att bara fylla i tomma rader hade låtit den gamla lögnen leva kvar.
    await prisma.product.updateMany({ where: { gtin: { not: null } }, data: { gtin: null } });
    const rows = await prisma.$queryRaw<{ productId: string; gtin: string }[]>`
      SELECT o."productId", MIN(o.gtin) AS gtin
      FROM "Offer" o
      WHERE o.gtin IS NOT NULL
      GROUP BY o."productId"
      HAVING COUNT(DISTINCT o.gtin) = 1
    `;
    for (const r of rows) {
      await prisma.product.update({ where: { id: r.productId }, data: { gtin: r.gtin } });
    }
    console.log(`  ${rows.length} produkter har en kanonisk GTIN.`);

    const conflicted = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT o."productId" FROM "Offer" o
        WHERE o.gtin IS NOT NULL
        GROUP BY o."productId" HAVING COUNT(DISTINCT o.gtin) > 1
      ) x
    `;
    const n = Number(conflicted[0]?.n ?? 0);
    if (n > 0) {
      console.log(
        `\n  ⚠ ${n} produkter har offers med OLIKA streckkoder = felaktiga butikslänkar.\n` +
          `    De lämnas MEDVETET utan Product.gtin. Kör: npx tsx scripts/gtin-report.ts`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
