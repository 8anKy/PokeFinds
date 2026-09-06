/**
 * Engångsimport för Wave 7 (2026-09-06): Sweet Nerds, Toyspace, Card Haven.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-wave7-import.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-wave7-import.ts "Sweet Nerds"
 *
 * Tre faser, i den ordningen med flit:
 *   FAS 1 `runScrapeJob` — matchar butikens annonser mot BEFINTLIGA katalogprodukter
 *          och skriver offers. Det är den här fasen som gör att butiken hamnar på
 *          produktsidor vi redan har, i stället för att skapa parallella rader.
 *   FAS 2 `runRestockScan` — feed-först-grenen, den ENDA kodväg som SKAPAR
 *          katalogprodukter ur en butiksfeed (för de SKU:er fas 1 inte kände igen).
 *   FAS 3 `exportRestockRoutes` — färsk ruttabell, annars är butikens SKU:er "okänd
 *          URL" för Discord-lanen till nästa nattkörning och postas alltså inte.
 *
 * ⛔ RESTOCK_SEED_SILENT=1 SÄTTS HÄR. De tre butikerna är visserligen NYA (och
 *    `restock-feed-events` seedar en källa utan tidigare lagerläge tyst av sig själv,
 *    MaxGaming-läxan 2026-08-12), men den mekanismen skyddar bara Discord-lanens
 *    diff. Feed-först-grenens NEW_LISTING-larm går en annan väg, och utan spaken
 *    hade Sweet Nerds 206 annonser mejlats som "Ny produkt i lager" till varje
 *    set-bevakare. Äkta restocks på befintliga offers larmar som vanligt.
 * ⛔ Kör FÖRE push av adapterändringarna om möjligt; annars snarast efter — varje
 *    10-minuterskörning däremellan riskerar larmsvall.
 * ⛔ Katalogkartorna laddas EN gång och delas (loadCatalogMaps) — Neon debiteras per
 *    vaken tid, inte per rad.
 */
import { requireEnv } from "./load-env";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runScrapeJob, loadCatalogMaps, runRestockScan } from "../src/scrapers/runner";
import { exportRestockRoutes } from "./lib/restock-routes";

// ⛔ Utan nyckeln blir LLM-domen null → hela gränsfallsbandet blir dubbletter
//    (provimporten 2026-08-07). Stanna hellre.
requireEnv("ANTHROPIC_API_KEY", "DATABASE_URL");
process.env.RESTOCK_SEED_SILENT = "1";

const WAVE7 = ["Sweet Nerds", "Toyspace", "Card Haven"];

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const wanted = only.length ? only : WAVE7;

  await ensureDbAwake();
  const before = await prisma.product.count();
  const maps = await loadCatalogMaps();

  let found = 0;
  let updated = 0;
  const present: string[] = [];
  for (const name of wanted) {
    const source = await prisma.scrapeSource.findFirst({ where: { name } });
    if (!source) {
      console.log(`${name.padEnd(22)} SAKNAS som ScrapeSource — kör setup-wave7-sources.ts --apply`);
      continue;
    }
    present.push(name);
    const started = Date.now();
    try {
      const r = await runScrapeJob(source.id, maps);
      found += r.itemsFound;
      updated += r.itemsUpdated;
      console.log(
        `${name.padEnd(22)} ${String(r.status).padEnd(9)} hittade=${String(r.itemsFound).padEnd(5)} uppdaterade=${String(r.itemsUpdated).padEnd(5)} fel=${r.errorCount}  (${((Date.now() - started) / 1000).toFixed(0)}s)`
      );
    } catch (err) {
      console.log(`${name.padEnd(22)} FEL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const linked = await prisma.product.count();
  console.log(`\nFAS 1 klar. Annonser: ${found} hittade, ${updated} uppdaterade.`);

  // ---- FAS 2: AUTO-IMPORT AV NYA SKU:er (tyst — se RESTOCK_SEED_SILENT ovan) ----
  const sourceRows = await prisma.scrapeSource.findMany({
    where: { name: { in: present }, isActive: true },
    select: { name: true, type: true, baseUrl: true, config: true },
  });
  const scan = await runRestockScan({
    sources: sourceRows.map((s) => ({
      name: s.name,
      type: s.type,
      baseUrl: s.baseUrl,
      rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
    })),
  });
  console.log(
    `FAS 2 klar. Butiker: ${scan.sources}, kontrollerade: ${scan.checked}, nya offers: ${scan.offersCreated ?? 0}, larm: ${scan.alertsSent}`
  );

  const after = await prisma.product.count();
  console.log(`\nKatalogprodukter: ${before} → ${linked} (fas 1) → ${after} (fas 2)`);
  console.log(`Nya produkter totalt: ${after - before >= 0 ? "+" : ""}${after - before}`);

  // ---- FAS 3: FÄRSK RUTTABELL för Discord-lanen ----
  const routesFile = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";
  await exportRestockRoutes(routesFile);
  console.log(`Ruttabell skriven: ${routesFile}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Samma skäl som scrape-all-run.ts: en kvarlämnad HTTP-socket håller
    // event-loopen vid liv långt efter att arbetet är klart.
    process.exit(process.exitCode ?? 0);
  });
