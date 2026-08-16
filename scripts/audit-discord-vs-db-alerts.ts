/**
 * VARFÖR KOM MEJLET MEN INTE DISCORD-INLÄGGET?
 *
 * Tar DB-lanens FACIT (RestockEvent — samma rader som utlöser mejl/push) för ett
 * fönster bakåt och frågar, händelse för händelse, om Discord-lanen kunde ha postat
 * den: fanns URL:en i ruttabellen (gamla grinden), och passerar butiksannonsen de
 * nya, katalogfria vakterna?
 *
 * Rapport-only. En läsning ur Neon, inga skrivningar, inga nätanrop.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/audit-discord-vs-db-alerts.ts [dagar]
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { buildRestockRoutes } from "./lib/restock-routes";
import { setDynamicDenylist } from "../src/scrapers/import-denylist";
import {
  buildDiscordFilterContext,
  classifyDiscordListing,
} from "../src/lib/discord-restock-filter";

const days = Math.max(1, Number(process.argv[2] ?? 3));

async function main() {
  const payload = await buildRestockRoutes();
  if (!payload) throw new Error("Ingen ruttabell");
  setDynamicDenylist(payload.deniedUrls);
  const ctx = buildDiscordFilterContext(payload);
  const watched = new Set(payload.sources.map((s) => s.name));

  const since = new Date(Date.now() - days * 86_400_000);
  const events = await prisma.restockEvent.findMany({
    where: { detectedAt: { gte: since } },
    select: {
      detectedAt: true,
      oldStatus: true,
      newStatus: true,
      retailer: { select: { name: true } },
      product: { select: { title: true, hiddenAt: true, category: true, language: true } },
      productId: true,
      retailerId: true,
    },
    orderBy: { detectedAt: "desc" },
  });

  // Offer-URL:en per (produkt, butik) — RestockEvent bär ingen URL själv.
  const offers = await prisma.offer.findMany({
    where: {
      productId: { in: [...new Set(events.map((e) => e.productId))] },
    },
    select: { productId: true, retailerId: true, url: true },
  });
  const urlByPair = new Map<string, string>();
  for (const o of offers) urlByPair.set(`${o.productId}:${o.retailerId}`, o.url);

  const restocks = events.filter(
    (e) => e.newStatus === "IN_STOCK" && e.oldStatus !== "IN_STOCK" && e.oldStatus !== "UNKNOWN"
  );

  console.log(
    `\n[audit] ${events.length} RestockEvent de senaste ${days} dygnen, varav ` +
      `${restocks.length} ÄKTA påfyllningar (OUT→IN).`
  );

  const buckets = {
    okBoth: 0,
    missingRouteOnly: 0,
    filteredOut: [] as string[],
    unwatchedStore: [] as string[],
    noUrl: 0,
  };
  const perStore = new Map<string, { total: number; noRoute: number; filtered: number }>();

  for (const e of restocks) {
    const store = e.retailer.name;
    const row = perStore.get(store) ?? { total: 0, noRoute: 0, filtered: 0 };
    row.total++;
    perStore.set(store, row);

    if (!watched.has(store)) {
      buckets.unwatchedStore.push(`${store}: ${e.product.title}`);
      continue;
    }
    const url = urlByPair.get(`${e.productId}:${e.retailerId}`);
    if (!url) {
      buckets.noUrl++;
      continue;
    }
    const hasRoute = Boolean(payload.routes[url]);
    if (!hasRoute) row.noRoute++;

    const verdict = classifyDiscordListing({ title: e.product.title, url }, ctx);
    if (!verdict.ok) {
      row.filtered++;
      if (buckets.filteredOut.length < 40) {
        buckets.filteredOut.push(`[${verdict.reason}] ${store}: ${e.product.title}`);
      }
      continue;
    }
    if (hasRoute) buckets.okBoth++;
    else buckets.missingRouteOnly++;
  }

  console.log("\n=== ÄKTA PÅFYLLNINGAR PER BUTIK ===");
  console.log("butik".padEnd(24), "restocks".padStart(9), "utan rutt".padStart(10), "vaktad bort".padStart(12));
  for (const [name, r] of [...perStore].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      name.padEnd(24),
      String(r.total).padStart(9),
      String(r.noRoute).padStart(10),
      String(r.filtered).padStart(12)
    );
  }

  console.log("\n=== UTFALL ===");
  console.log(`  Postbara i BÅDA modellerna        : ${buckets.okBoth}`);
  console.log(`  Postbara BARA i den nya (ingen rutt): ${buckets.missingRouteOnly}`);
  console.log(`  Fällda av vakterna (postas aldrig) : ${restocks.length - buckets.okBoth - buckets.missingRouteOnly - buckets.unwatchedStore.length - buckets.noUrl}`);
  console.log(`  Butiken inte i Discord-källistan   : ${buckets.unwatchedStore.length}`);
  console.log(`  Ingen offer-URL att döma på        : ${buckets.noUrl}`);

  if (buckets.filteredOut.length) {
    console.log("\n=== FÄLLDA AV VAKTERNA (kontrollera att inget riktigt står här) ===");
    for (const s of buckets.filteredOut) console.log(`  · ${s}`);
  }
  if (buckets.unwatchedStore.length) {
    console.log("\n=== BUTIKER UTANFÖR DISCORD-KÄLLISTAN ===");
    for (const s of buckets.unwatchedStore.slice(0, 20)) console.log(`  · ${s}`);
  }

  // Dygnsfördelning — visar om lanen har DÖDA fönster (t.ex. jobbglapp eller
  // nattliga cache-tapp) i stället för ett jämnt flöde.
  const perHour = new Map<string, number>();
  for (const e of restocks) {
    const k = e.detectedAt.toISOString().slice(0, 13);
    perHour.set(k, (perHour.get(k) ?? 0) + 1);
  }
  console.log("\n=== PÅFYLLNINGAR PER TIMME (UTC) ===");
  for (const [h, n] of [...perHour].sort()) console.log(`  ${h}:00  ${"█".repeat(n)} ${n}`);
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
