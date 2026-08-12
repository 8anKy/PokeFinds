/**
 * Exporterar det Discord-snabbfilen behöver för att vara HELT DB-FRI:
 *   1. KÄLLISTAN (restock-bevakade butiker: namn, typ, baseUrl, rotatingFeed)
 *   2. RUTTABELLEN (butiks-URL → vår produkt: titel, slug, set, serie)
 *
 * Körs SIST i scrape-all, där Neon ändå är vaken — därför kostar den noll extra
 * compute. ⛔ Lägg den ALDRIG i en egen cron: Neon debiteras per VAKEN TID och varje
 * väckning köper minst 300 s. Hela poängen med snabbfilen är att den aldrig väcker
 * databasen, och en exportör som gör det själv hade ätit upp besparingen.
 *
 * Utfallet skrivs som EN JSON-fil som GitHub Actions cachar; snabbfilen restaurerar
 * den med en egen nyckel. Blir filen gammal (butiker byter sortiment) märks det som
 * "okänd URL" i snabbfilens logg, aldrig som fel data — okända URL:er postas inte.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/export-restock-routes.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "@/lib/db";
import type { RestockSourceInfo } from "@/scrapers/runner";
import type { RouteTable } from "@/lib/restock-feed-events";

const OUT = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";

async function main() {
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
    return;
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
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload));

  const withSeries = Object.values(routes).filter((r) => r.series).length;
  console.log(
    `[export-routes] ${sources.length} källor, ${Object.keys(routes).length} URL:er ` +
      `(${withSeries} med serie, ${Object.keys(routes).length - withSeries} utan → catch-all) → ${OUT}`
  );
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
