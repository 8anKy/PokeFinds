/**
 * AUTO-IMPORT AV NYA BUTIKS-SKU:ER — som STEG i nattkedjan (`scrape-all.yml`).
 *
 *   npx tsx scripts/feed-import-run.ts
 *
 * Eftersläpningen MÄTS utan att röra något med `scripts/audit-feed-first-gap.ts`.
 *
 * ⛔ VARFÖR FILEN FINNS. Feed-först-grenen i `runRestockScan` är den ENDA kodväg som
 * SKAPAR katalogprodukter ur butiksfeedar. `runScrapeJob` (nattens fulla insamling)
 * matchar bara mot BEFINTLIGA produkter och hoppar över allt som inte matchar — den
 * har aldrig skapat något. När `restock-watch.yml` pausades 2026-08-23 (kostnad, se
 * CLAUDE.md) följde alltså auto-importen med ner, utan att det stod någonstans.
 *
 * MÄTT I PROD 2026-09-03, elva dygn senare: den nyaste `StoreListing`-raden hos
 * VARJE av de 41 bevakade butikerna var daterad ≤ 2026-08-22. Noll nya butiks-SKU:er
 * på elva dygn. Backloggen var 3 137 sealed feed-URL:er utan Offer (1 231 i lager),
 * varav 705 överlevde de billiga vakterna — bland dem 30th Celebration-ETB:n hos
 * Pokexclusive, i lager, som ägaren letade efter.
 *
 * ⛔ LÄGGS SOM STEG, ALDRIG EGEN CRON. Neon debiteras per VAKEN TID och är redan
 * vaken i scrape-alls fönster; en egen start hade varit ytterligare en väckning à
 * minst 300 s. Samma regel som veckobrevet och utmärkelserna följer.
 *
 * ⛔ LARMEN PÅVERKAS INTE. `RESTOCK_ALERTS_PAUSED=1` står redan i scrape-alls
 * env-block, och grinden ligger vid SKAPANDET (`checkListingAlerts` returnerar
 * direkt) — importen skapar produkter och offers, aldrig larmrader. Slås larmen på
 * igen larmar den här vägen som förr, vilket är avsikten.
 *
 * ⛔ TIDSBUDGET, INTE ANTALSTAK. Varje offer-lös feed-URL kostar en artigt fördröjd
 * hämtning av butikens produktsida; hela backloggen är timmar. `scrape-all` har 120
 * min totalt och drar redan 20–38, och en timeout där tar HELA nattkedjan med sig
 * (tradera-sweep m.fl. hänger på `workflow_run` och fyrar aldrig efter en timeout).
 * Budgeten är MINUTER eftersom kön är ordnad per butik — ett antalstak hade tömt
 * samma butiker varje natt och svultit svansen. Resten tas nästa natt: passet är
 * resumerbart av naturen (en importerad URL får en Offer och lämnar kön för gott).
 */
import "./load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runRestockScan } from "../src/scrapers/runner";

/** Default 25 min: scrape-all ligger på 20–38 min av sina 120, GTIN-passet tar sitt. */
const BUDGET_MINUTES = Math.max(1, Number(process.env.FEED_IMPORT_BUDGET_MINUTES ?? 25));

async function main() {
  // Väck Neon före första riktiga frågan — se ensureDbAwake. (Anropas här också
  // fastän scrape-all redan kört: skriptet ska gå att köra ensamt för hand.)
  await ensureDbAwake();

  // BEVAKADE LÄNKAR: butiks-URL:er ingen feed nämner (admin → Bevakade länkar).
  // Läses HÄR, inte i runRestockScan — fas 1 måste vara DB-fri för Discord-lanens skull.
  const watchedRows = await prisma.watchedListing.findMany({
    where: { isActive: true },
    select: { id: true, url: true, retailer: { select: { name: true } } },
  });
  const watched = watchedRows.map((w) => ({ sourceName: w.retailer.name, url: w.url }));
  const idByKey = new Map(watchedRows.map((w) => [`${w.retailer.name}	${w.url}`, w.id]));

  const r = await runRestockScan({ importBudgetMs: BUDGET_MINUTES * 60_000, watched });

  // Svaren tillbaka till adminlistan: "frågade vi, och vad sa butiken?".
  // ⛔ Bara diagnostik — lagerdiffen som driver larm bor i Offer/StoreListing. Två
  // sanningar om samma lagerstatus är hur flappen uppstår.
  for (const res of r.watchedResults ?? []) {
    const id = idByKey.get(`${res.sourceName}	${res.url}`);
    if (!id) continue;
    await prisma.watchedListing.update({
      where: { id },
      data: {
        lastCheckedAt: new Date(),
        // Inget svar ⇒ rör inte statusen. `null` betyder "vet inte", aldrig "slut".
        ...(res.status ? { lastStatus: res.status } : {}),
        ...(res.priceOre != null ? { lastPriceOre: res.priceOre } : {}),
        ...(res.title ? { lastTitle: res.title } : {}),
        lastError: res.inFeed ? null : res.error,
      },
    });
  }

  console.log(
    `[feed-import] ${r.sources} butiker, ${r.checked} feed-först-annonser prövade, ` +
      `${r.offersCreated ?? 0} nya offers/produkter, ${watched.length} bevakade länkar, ` +
      `budget ${BUDGET_MINUTES} min.`
  );

  // ⛔ EN BEVAKNING SOM ALDRIG SVARAR ÄR VÄRRE ÄN INGEN: den ser ut att göra jobbet.
  // Butiken kan ha bytt URL, tagit bort sidan eller slutat publicera strukturerad data.
  // Syns på körningen, inte bara i loggen.
  const mute = (r.watchedResults ?? []).filter((x) => x.error);
  if (mute.length) {
    console.log(
      `::warning::${mute.length} bevakad(e) länk(ar) svarade inte: ` +
        mute.map((m) => `${m.sourceName} ${m.url} (${m.error})`).join(" · ")
    );
  }

  // ⛔ SYNLIGT PÅ SJÄLVA KÖRNINGEN, inte bara i loggen. En kvarvarande kö betyder att
  // eftersläpningen krymper långsammare än den växer, och det är precis den sortens
  // tysta gräns som lät auto-importen ligga nere i elva dygn utan att någon såg det.
  if ((r.importBudgetLeft ?? 0) > 0) {
    console.log(
      `::warning::Feed-importen hann inte klart: ${r.importBudgetLeft} offer-lösa ` +
        `butiks-URL:er kvar i kön efter ${BUDGET_MINUTES} min. De tas nästa natt — ` +
        `krymper talet inte mellan nätterna, höj FEED_IMPORT_BUDGET_MINUTES.`
    );
  }

  // NYA OFFERS → exportera om Discord-lanens ruttabell NU (samma skäl som i
  // restock-watch-run.ts: Neon är garanterat vaken, och utan omexporten är en ny
  // SKU:s första restock "okänd URL" i Discord i upp till ett dygn).
  const routesFile = process.env.RESTOCK_ROUTES_FILE;
  if (routesFile && (r.offersCreated ?? 0) > 0) {
    try {
      const { exportRestockRoutes } = await import("./lib/restock-routes");
      await exportRestockRoutes(routesFile);
    } catch (e) {
      console.warn("[feed-import] Kunde inte exportera ruttabellen:", e instanceof Error ? e.message : e);
    }
  }

  // Källistan åt nästa körning (samma cache-kontrakt som restock-watch-run.ts).
  const srcFile = process.env.RESTOCK_SOURCES_FILE;
  if (srcFile && r.sourceList?.length) {
    try {
      mkdirSync(dirname(srcFile), { recursive: true });
      writeFileSync(srcFile, JSON.stringify({ at: Date.now(), sources: r.sourceList }));
    } catch (e) {
      console.warn("[feed-import] Kunde inte skriva källcachen:", e instanceof Error ? e.message : e);
    }
  }
}

main()
  .catch((e) => {
    console.error("[feed-import] Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Avsluta EXPLICIT — kvarlämnade HTTP-handles från skraporna håller annars
    // event-loopen vid liv tills GitHub dödar jobbet på timeout-taket (samma fälla
    // som brände en vecka av Actions-minuter 1–8 juli 2026, se scrape-all-run.ts).
    process.exit(process.exitCode ?? 0);
  });
