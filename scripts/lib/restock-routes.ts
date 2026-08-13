/**
 * Själva ruttabells-exporten för Discord-snabbfilen — utbruten ur
 * scripts/export-restock-routes.ts (2026-08-13) så den kan anropas från TVÅ ställen:
 *   1. scrape-all (nattlig fullexport, som förut)
 *   2. restock-watch-lanen NÄR den skapat nya offers (auto-import) — Neon är då redan
 *      vaken, och utan omexporten är en ny SKU:s första restock "okänd URL" i Discord-
 *      lanen i upp till ett dygn (Samlarhobbys Paradox Rift-booster 2026-08-12
 *      upptäcktes av 2-min-lanen FÖRE DB-lanen men kunde aldrig postas).
 *
 * ⛔ Bor under scripts/ (inte src/jobs/) med flit: node:fs får inte dras in i
 * Next-bundlen via instrumentation, samma regel som CLI-wrapprarnas grindar.
 *
 * ⛔ Anropa ALDRIG från en väg där Neon sover — exporten läser ScrapeSource + Offer,
 * och en väckning köper minst 300 s debiterad tid.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "../../src/lib/db";
import type { RestockSourceInfo } from "../../src/scrapers/runner";
import type { RouteTable } from "../../src/lib/restock-feed-events";

export async function exportRestockRoutes(outFile: string): Promise<{ sources: number; routes: number } | null> {
  const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const sources: RestockSourceInfo[] = active
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .map((s) => ({
      name: s.name,
      type: s.type,
      baseUrl: s.baseUrl,
      rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
    }));

  if (sources.length === 0) {
    console.warn("[export-routes] Inga restock-bevakade källor — skriver ingen fil.");
    return null;
  }

  // Bara butikerna snabbfilen faktiskt hämtar. Retailer.name === ScrapeSource.name
  // (samma nyckel som runRestockScan använder via retailerByName).
  const names = sources.map((s) => s.name);
  const retailers = await prisma.retailer.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });

  const offers = await prisma.offer.findMany({
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    select: {
      url: true,
      product: {
        select: {
          title: true,
          slug: true,
          language: true,
          imageUrl: true,
          set: { select: { name: true, series: true } },
        },
      },
    },
  });

  // URL → produkt. En URL kan i teorin bära flera offers (olika produkter) efter en
  // felaktig länkning; först vinner, och länkrevisionen (audit-links.ts) är rätt
  // ställe att lösa det — inte här.
  const routes: RouteTable = {};
  for (const o of offers) {
    if (routes[o.url]) continue;
    routes[o.url] = {
      title: o.product.title,
      slug: o.product.slug,
      setName: o.product.set?.name ?? null,
      series: o.product.set?.series ?? null,
      // Språket styr KANALVALET: JP-set bär samma latinska serienamn som de engelska
      // ("Mega Evolution"), så utan språket hade JP-boxar routats till EN-seriekanalen
      // (hände 2026-08-12: fyra japanska boxar i #mega-evolution).
      language: o.product.language,
      // Katalogbilden som reserv för embed-miniatyren — butiksfeedarna bär sällan bild.
      imageUrl: o.product.imageUrl ?? null,
    };
  }

  const payload = { at: Date.now(), sources, routes };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(payload));

  const withSeries = Object.values(routes).filter((r) => r.series).length;
  console.log(
    `[export-routes] ${sources.length} källor, ${Object.keys(routes).length} URL:er ` +
      `(${withSeries} med serie, ${Object.keys(routes).length - withSeries} utan → catch-all) → ${outFile}`
  );
  return { sources: sources.length, routes: Object.keys(routes).length };
}
