/**
 * Kör insamlingen för de nya butikerna EN gång, en i taget.
 *
 * Varför inte bara vänta på den dagliga `scrape-all`: första passet för 23 butiker är
 * det enda som importerar ~3 000 annonser på en gång, och det är precis då man vill se
 * per-butik-utfallet i klartext i stället för att leta i en 40-minuters jobblogg.
 * Efter det här passet sköter den dagliga körningen dem som alla andra.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-wave4-import.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-wave4-import.ts "Card Club"
 *
 * ⛔ Katalogkartorna laddas EN gång och delas mellan butikerna (loadCatalogMaps).
 *    Utan det bygger varje butik om hela matchningsindexet — 23 fullskanningar av
 *    katalogen i följd, och Neon debiteras per vaken tid.
 */
import { requireEnv } from "./load-env";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runScrapeJob, loadCatalogMaps, runRestockScan } from "../src/scrapers/runner";

// ⛔ Utan nyckeln blir LLM-domen null, vilket är omöjligt att skilja från "olika
//    produkter" — och HELA gränsfallsbandet blir dubbletter i stället för länkar.
//    Det är precis vad som hände i provimporten 2026-08-07. Stanna hellre.
requireEnv("ANTHROPIC_API_KEY", "DATABASE_URL");

const WAVE4 = [
  "TCG Store", "Beam Cardshop", "Hobbykort", "Pokétalk", "Kanto Vault", "Pokemurre",
  "AuroraDex", "Tiny Misters", "Cardlevels", "Kortarkivet", "RahTech", "Card Club",
  "Blindbox", "RGB Kingz", "Miniature Metropolis", "Pokexclusive", "Spelgalaxen",
  "CardGame", "Mystery Shack", "Packs on Packs",
  "Fantasia North", "The Swedish Fish", "Pocketmonsters",
];

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const wanted = only.length ? only : WAVE4;

  await ensureDbAwake();
  const before = await prisma.product.count();
  const maps = await loadCatalogMaps();

  let found = 0;
  let updated = 0;
  for (const name of wanted) {
    const source = await prisma.scrapeSource.findFirst({ where: { name } });
    if (!source) {
      console.log(`${name.padEnd(22)} SAKNAS som ScrapeSource — kör setup-wave4-sources.ts --apply`);
      continue;
    }
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

  // ---- FAS 2: AUTO-IMPORT AV NYA SKU:er ----
  // runScrapeJob LÄNKAR bara (`if (!match) continue`) — den skapar aldrig en produkt.
  // Katalogprodukter för butiks-URL:er vi inte känner igen skapas av ensureListingProduct,
  // och den kodvägen sitter i restock-skanningen. Utan det här steget hade de nya
  // butikerna bara prissatt varor vi redan hade, och deras egna SKU:er aldrig synts.
  //
  // ⛔ `sources` skickas in EXPLICIT i stället för att flagga config.restockWatch:
  //    lanen kör var 10:e minut och Neon debiteras per vaken tid. Det här är ETT pass.
  // ⛔ TYST SEEDNING: larm kräver att butiken redan har StoreListing-historik
  //    (`seededRetailers` i runner.ts). De 23 butikerna har ingen ⇒ deras kataloger
  //    mejlas inte ut som "ny produkt". Kör det här passet EN gång per butik, aldrig
  //    om efter att huvudboken finns — då är annonserna inte längre nya.
  const sourceRows = await prisma.scrapeSource.findMany({
    where: { name: { in: wanted }, isActive: true },
    select: { name: true, type: true, baseUrl: true },
  });
  const scan = await runRestockScan({ sources: sourceRows.map((s) => ({ ...s, rotatingFeed: false })) });
  console.log(
    `FAS 2 klar. Butiker: ${scan.sources}, kontrollerade: ${scan.checked}, nya annonser: ${scan.newListings}, larm: ${scan.alertsSent}`
  );

  const after = await prisma.product.count();
  console.log(`\nKatalogprodukter: ${before} → ${linked} (fas 1) → ${after} (fas 2)`);
  console.log(`Nya produkter totalt: ${after - before >= 0 ? "+" : ""}${after - before}`);
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
