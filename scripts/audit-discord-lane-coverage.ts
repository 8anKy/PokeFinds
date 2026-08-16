/**
 * MÄTER HUR MYCKET DISCORD-LANEN INTE SER.
 *
 * Frågan skriptet svarar på: av allt de bevakade butikerna har i lager just nu, hur
 * mycket skulle Discord-lanen kunna posta om varan fylldes på i det här ögonblicket?
 *
 * Den gamla lanen grindade på RUTTABELLEN (butiks-URL → vår katalogprodukt). Allt
 * utanför katalogen postades aldrig, tyst — medan mejl/push gick ut som vanligt via
 * DB-lanen. Skriptet visar exakt det gapet, per butik, och delar upp resten på VILKEN
 * vakt som fäller (så en vidgning inte råkar öppna för tillbehör eller singlar).
 *
 * ⛔ EN läsning ur Neon (ruttabell + setnamn), resten är ren HTTP mot butikernas
 *    feedar — samma fas 1 som lanen själv kör. Kör den inte i en loop.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/audit-discord-lane-coverage.ts
 */
import "./load-env";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { runRestockScan, type FeedItem } from "../src/scrapers/runner";
import { buildRestockRoutes } from "./lib/restock-routes";
import { setDynamicDenylist } from "../src/scrapers/import-denylist";
import {
  buildDiscordFilterContext,
  classifyDiscordListing,
} from "../src/lib/discord-restock-filter";

async function main() {
  const payload = await buildRestockRoutes();
  if (!payload) {
    console.error("Ingen ruttabell kunde byggas — inga restock-bevakade källor?");
    process.exit(1);
  }
  const { sources, routes } = payload;
  setDynamicDenylist(payload.deniedUrls);
  const ctx = buildDiscordFilterContext(payload);
  console.log(
    `[audit] Ruttabell: ${Object.keys(routes).length} URL:er, ${sources.length} källor, ` +
      `${ctx.setNames.size} normaliserade setnamn.`
  );

  const fetched: { sourceName: string; items: FeedItem[] }[] = [];
  await runRestockScan({
    sources,
    shouldProcess: async (groups) => {
      fetched.push(...groups);
      return false; // ⛔ rör aldrig DB-fasen
    },
  });

  type Row = {
    inStock: number;
    postable: number;
    postableNoRoute: number;
    rejected: Record<string, number>;
  };
  const perStore = new Map<string, Row>();
  const examplesNoRoute: string[] = [];
  const examplesRejected = new Map<string, string[]>();
  /** Fällda OCH utan rutt = det som verkligen aldrig når kanalen. */
  const blindTotals: Record<string, number> = {};
  const blindExamples = new Map<string, string[]>();
  /** Alla blinda rader — skrivs till fil med --dump <fil> för mönsteranalys. */
  const blindRows: { store: string; title: string; url: string; reason: string }[] = [];

  for (const g of fetched) {
    const row: Row = { inStock: 0, postable: 0, postableNoRoute: 0, rejected: {} };
    for (const it of g.items) {
      if (it.stockStatus !== "IN_STOCK") continue;
      row.inStock++;
      const verdict = classifyDiscordListing(
        { title: it.title, url: it.url, category: it.category },
        ctx
      );
      if (!verdict.ok) {
        const r = verdict.reason ?? "okänd";
        row.rejected[r] = (row.rejected[r] ?? 0) + 1;
        // ⛔ EN FÄLLD ANNONS MED RUTT ÄR INTE FÖRLORAD — rutten övertrumfar vakterna
        //    (utom språk/denylist), så den postas ändå. Det som FAKTISKT aldrig når
        //    kanalen är "fälld OCH utan rutt". Räknas de ihop ser bortfallet
        //    tiofalt större ut än det är, och man börjar vidga vakter i onödan.
        const rescued =
          Boolean(routes[it.url]) && r !== "language" && r !== "denylist";
        if (!rescued) {
          blindTotals[r] = (blindTotals[r] ?? 0) + 1;
          blindRows.push({ store: g.sourceName, title: it.title, url: it.url, reason: r });
          const bl = blindExamples.get(r) ?? [];
          if (bl.length < 8) {
            bl.push(`${g.sourceName}: ${it.title}`);
            blindExamples.set(r, bl);
          }
        }
        const list = examplesRejected.get(r) ?? [];
        if (list.length < 6) {
          list.push(`${g.sourceName}: ${it.title}`);
          examplesRejected.set(r, list);
        }
        continue;
      }
      row.postable++;
      if (!routes[it.url]) {
        row.postableNoRoute++;
        if (examplesNoRoute.length < 40) {
          examplesNoRoute.push(`${g.sourceName}: ${it.title}  →  ${it.url}`);
        }
      }
    }
    perStore.set(g.sourceName, row);
  }

  const tot = { inStock: 0, postable: 0, postableNoRoute: 0 };
  const rejectedTotals: Record<string, number> = {};
  for (const r of perStore.values()) {
    tot.inStock += r.inStock;
    tot.postable += r.postable;
    tot.postableNoRoute += r.postableNoRoute;
    for (const [k, v] of Object.entries(r.rejected)) rejectedTotals[k] = (rejectedTotals[k] ?? 0) + v;
  }

  console.log("\n=== PER BUTIK (i lager nu) ===");
  console.log("butik".padEnd(24), "i lager".padStart(8), "postbara".padStart(9), "utan rutt".padStart(10), " (= osynliga för Discord i dag)");
  for (const [name, r] of [...perStore].sort((a, b) => b[1].postableNoRoute - a[1].postableNoRoute)) {
    console.log(
      name.padEnd(24),
      String(r.inStock).padStart(8),
      String(r.postable).padStart(9),
      String(r.postableNoRoute).padStart(10)
    );
  }

  console.log("\n=== TOTALT ===");
  console.log(`  I lager över alla butiker : ${tot.inStock}`);
  console.log(`  Passerar Discord-vakterna : ${tot.postable}`);
  console.log(
    `  …varav UTAN rutt i dag    : ${tot.postableNoRoute} ` +
      `(${((100 * tot.postableNoRoute) / Math.max(1, tot.postable)).toFixed(1)} % av de postbara)`
  );

  console.log("\n=== FÄLLDA AV VAKTERNA (skulle ALDRIG postas) ===");
  for (const [reason, n] of Object.entries(rejectedTotals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${String(n).padStart(6)}`);
    for (const ex of examplesRejected.get(reason) ?? []) console.log(`      · ${ex}`);
  }

  console.log("\n=== VAD SOM FAKTISKT ALDRIG NÅR KANALEN (fälld OCH utan rutt) ===");
  console.log("  En fälld annons MED rutt postas ändå — rutten övertrumfar vakterna.");
  for (const [reason, n] of Object.entries(blindTotals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${String(n).padStart(6)}`);
    for (const ex of blindExamples.get(reason) ?? []) console.log(`      · ${ex}`);
  }

  // `--dump <fil>`: hela den blinda listan som JSON. Åtta exempel per orsak räcker
  // för att se ATT en klass finns, aldrig för att se om den är systematisk.
  const dumpIdx = process.argv.indexOf("--dump");
  if (dumpIdx > 0 && process.argv[dumpIdx + 1]) {
    writeFileSync(process.argv[dumpIdx + 1], JSON.stringify(blindRows, null, 1));
    console.log(`\n[audit] ${blindRows.length} blinda rader → ${process.argv[dumpIdx + 1]}`);
  }

  console.log("\n=== EXEMPEL: postbara UTAN rutt (bortfallet som ombygget löste) ===");
  for (const ex of examplesNoRoute) console.log(`  · ${ex}`);
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
