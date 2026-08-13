/**
 * Engångsimport för Wave 5 (2026-08-13) — OCH tyst omseedning av de befintliga
 * butiker vars feed-täckning just utökades (Samlarhobby 379→975 synliga produkter,
 * TCG Store, Pokétalk, Speltrollet, Hobbykort, Kanto Vault — wholeCatalog-bytet).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-wave5-import.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-wave5-import.ts "Aquitaz"
 *
 * ⛔ RESTOCK_SEED_SILENT=1 SÄTTS HÄR OCH BARA HÄR: de utökade butikerna HAR
 *    StoreListing-historik, så utan spaken hade FAS 2 mejlat hela utökningen som
 *    "Ny produkt i lager" till set-bevakare (wave 4-mekanismen skyddar bara butiker
 *    UTAN historik). Larmtystnaden gäller bara feed-först-grenen — äkta restocks på
 *    befintliga offers larmar som vanligt.
 * ⛔ Kör det här FÖRE push av adapterändringarna om möjligt; annars snarast efter —
 *    varje 10-min-körning däremellan riskerar larmsvall.
 * ⛔ Katalogkartorna laddas EN gång och delas (loadCatalogMaps) — Neon debiteras per
 *    vaken tid.
 */
import { requireEnv } from "./load-env";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runScrapeJob, loadCatalogMaps, runRestockScan } from "../src/scrapers/runner";
import { exportRestockRoutes } from "./lib/restock-routes";

// ⛔ Utan nyckeln blir LLM-domen null → hela gränsfallsbandet blir dubbletter
//    (provimporten 2026-08-07). Stanna hellre.
requireEnv("ANTHROPIC_API_KEY", "DATABASE_URL");
process.env.RESTOCK_SEED_SILENT = "1";

/** Nya Wave 5-butiker + befintliga butiker med utökad feed-täckning. */
const WAVE5_AND_EXPANDED = [
  // Nya (registrerade av setup-wave5-sources.ts; Playoteket/Carsmästaren = robots, se det skriptet)
  "Aquitaz", "Rogerz", "Yonko TCG", "Firegames", "Spelkortsbutiken",
  "Leksaksaffären", "NordicTCG", "Coolcard",
  // Befintliga med utökad täckning (wholeCatalog-bytet 2026-08-13)
  "Samlarhobby", "TCG Store", "Pokétalk", "Speltrollet", "Hobbykort", "Kanto Vault",
];

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const wanted = only.length ? only : WAVE5_AND_EXPANDED;

  await ensureDbAwake();
  const before = await prisma.product.count();
  const maps = await loadCatalogMaps();

  let found = 0;
  let updated = 0;
  const present: string[] = [];
  for (const name of wanted) {
    const source = await prisma.scrapeSource.findFirst({ where: { name } });
    if (!source) {
      console.log(`${name.padEnd(22)} SAKNAS som ScrapeSource — kör setup-wave5-sources.ts --apply`);
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
  // Neon är redan vaken; de nya offersen ska in i ruttabellen direkt, inte i morgon
  // natt. Filen cachas av nästa restock-watch-körning ELLER kan sparas manuellt via
  // workflow-dispatchen "Ruttabell för Discord-larm (manuell)".
  const routesFile = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";
  await exportRestockRoutes(routesFile);
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
