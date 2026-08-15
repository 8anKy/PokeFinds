/**
 * ENGÅNGSIMPORT efter KATEGORIVIDGNINGEN 2026-08-15 — och den måste vara TYST.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-category-widening-import.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-category-widening-import.ts "Spelexperten" "MaxGaming"
 *
 * BAKGRUND: `guessListingCategory` lärde sig formerna som tidigare föll till `OTHER`
 * (Battle Decks, World Championship Decks, Build & Battle, Starter Sets, Trainer's
 * Toolkit, kvalificerade Collections, promo-paket). Feed-först-grenen grindar på
 * SEALED_FEED_CATEGORIES, så de annonserna kunde aldrig bli katalogprodukter — MÄTT
 * mot 42 butikers levande feedar: 436 av 479 saknade offers enbart av det skälet.
 *
 * ⛔ RESTOCK_SEED_SILENT=1 SÄTTS HÄR OCH BARA HÄR. Butikerna HAR StoreListing-historik,
 *    så utan spaken mejlas varje nyupptäckt URL som "Ny produkt i lager" till varje
 *    set-bevakare och varje Pro med "Alla restocks" — ~144 mejl i en smäll för varor
 *    som stått i butikshyllan i månader. Exakt samma fälla som när Samlarhobbys
 *    täckning gick 379 → 975 (2026-08-13).
 * ⛔ KÖR DET HÄR FÖRE PUSH av adapterändringarna. Varje 10-minuterskörning som hinner
 *    emellan gör larmsvallet i stället.
 * ⛔ Kräver ANTHROPIC_API_KEY: utan den returnerar `judgeSameProduct` null, vilket är
 *    omöjligt att skilja från "olika produkter", och HELA gränsfallsbandet blir
 *    dubbletter (provimporten 2026-08-07 gav 2 dubbletter av 3 nya produkter).
 */
import { requireEnv } from "./load-env";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runRestockScan } from "../src/scrapers/runner";
import { exportRestockRoutes } from "./lib/restock-routes";

requireEnv("ANTHROPIC_API_KEY", "DATABASE_URL");
process.env.RESTOCK_SEED_SILENT = "1";

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  await ensureDbAwake();
  const before = await prisma.product.count();

  const sourceRows = await prisma.scrapeSource.findMany({
    where: { isActive: true },
    select: { name: true, type: true, baseUrl: true, config: true },
  });
  const sources = sourceRows
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .filter((s) => !only.length || only.includes(s.name))
    .map((s) => ({
      name: s.name,
      type: s.type,
      baseUrl: s.baseUrl,
      rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
    }));

  console.log(`[widening] Tyst seedning av ${sources.length} butiker (RESTOCK_SEED_SILENT=1).`);
  const scan = await runRestockScan({ sources });
  console.log(
    `[widening] Klart. Butiker: ${scan.sources}, kontrollerade: ${scan.checked}, ` +
      `nya offers: ${scan.offersCreated ?? 0}, larm skickade: ${scan.alertsSent} ` +
      `(ska vara 0 för NYA annonser — äkta restocks på befintliga offers larmar som vanligt).`
  );

  const after = await prisma.product.count();
  console.log(`[widening] Katalogprodukter: ${before} → ${after} (${after - before >= 0 ? "+" : ""}${after - before})`);

  // Färsk ruttabell så Discord-lanen kan posta om de nya SKU:erna direkt i stället för
  // att kalla dem "okänd URL" i upp till ett dygn.
  await exportRestockRoutes(process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json");
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
