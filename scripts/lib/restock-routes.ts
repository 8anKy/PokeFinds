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

/**
 * Ruttabellsfilens innehåll. `routes` är numera ENRIKNING, inte en grind:
 * Discord-lanen postar på butiksannonsens egna meriter (se
 * `src/lib/discord-restock-filter.ts`) och använder rutten för att sätta en snyggare
 * titel, rätt kanal och en länk till vår produktsida NÄR vi känner igen URL:en.
 */
export interface RestockRoutesPayload {
  at: number;
  sources: RestockSourceInfo[];
  routes: RouteTable;
  /**
   * Katalogens setnamn — enda indatan Discord-lanens POSITIVA Pokémon-vakt behöver
   * ur databasen. Skickas som RÅA namn; lanen normaliserar själv.
   * ⛔ Måste täcka mer än `routes` gör: ett HELT NYTT set har ännu inga offers, och
   *    utan namnet faller dess första påfyllning på "no-pokemon-signal" om butikens
   *    titel varken nämner "Pokémon" eller en Pokémon-karaktär.
   */
  setNames: string[];
  /**
   * Admin-nekade butiks-URL:er (`DeniedListingUrl`). Utan dem postar Discord-lanen
   * glatt en URL ägaren nyss tagit bort på produktsidan — raderingen ska gälla i
   * ALLA kanaler, inte bara i katalogen.
   */
  deniedUrls: string[];
  /**
   * Set → id/serie/språk. Låter lanen välja RÄTT kanal även för en URL som saknar
   * rutt: setnamnet står nästan alltid i butikens titel. Utan detta hade varje ny SKU
   * hamnat i catch-all och seriekanalerna blivit tomma skal.
   *
   * `id` bär dessutom RESERVLÄNKEN i inlägget: `/produkter?set=<id>` (katalogsidan
   * filtrerar på `setId`). En URL utan rutt har ingen produktsida att peka på — men
   * setet vet vi, och en setlänk kan varken bli fel eller landa tomt.
   */
  sets: { id: string; name: string; series: string | null; language: string | null }[];
}

export async function buildRestockRoutes(): Promise<RestockRoutesPayload | null> {
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
  const put = (
    url: string,
    product: { title: string; slug: string; language: string | null; imageUrl: string | null; set: { name: string; series: string | null } | null }
  ) => {
    if (routes[url]) return;
    routes[url] = {
      title: product.title,
      slug: product.slug,
      setName: product.set?.name ?? null,
      series: product.set?.series ?? null,
      // Språket styr KANALVALET: JP-set bär samma latinska serienamn som de engelska
      // ("Mega Evolution"), så utan språket hade JP-boxar routats till EN-seriekanalen
      // (hände 2026-08-12: fyra japanska boxar i #mega-evolution).
      language: product.language,
      // Katalogbilden som reserv för embed-miniatyren — butiksfeedarna bär sällan bild.
      imageUrl: product.imageUrl ?? null,
    };
  };
  for (const o of offers) put(o.url, o.product);

  // ---- HUVUDBOKEN FYLLER PÅ (2026-08-15) ----
  // ⛔ EN URL UTAN OFFER KAN ÄNDÅ VARA EN KÄND PRODUKT. `Offer` är unik på
  // (produkt, butik, skick, språk), så när en butik säljer samma vara under TVÅ
  // URL:er får bara den ena en offer — den andra kan per konstruktion aldrig få en
  // (Rogerz listar varje begagnad vara under båda danska momsordningarna; 87 av
  // deras huvudboksrader är bundna men offer-lösa). Ruttabellen byggdes bara ur
  // Offer, så en påfyllning på den andra URL:en blev "okänd URL" i Discord-lanen
  // och postades ALDRIG — tyst, och omöjligt att se skillnad på från en sleeve.
  // `StoreListing.productId` är samma dom, redan betald och nerskriven (memot från
  // 2026-08-14). Offers vinner fortfarande: de är kontrollerade av länkrevisionen.
  const ledger = await prisma.storeListing.findMany({
    where: { retailerId: { in: retailers.map((r) => r.id) }, productId: { not: null } },
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
  let fromLedger = 0;
  for (const l of ledger) {
    if (!l.product || routes[l.url]) continue;
    put(l.url, l.product);
    fromLedger++;
  }

  // ---- KATALOGENS TAXONOMI (2026-08-16) ----
  // Discord-lanen slutade grinda på ruttabellen och dömer numera butiksannonsen
  // själv. Två saker klarar den ändå inte utan oss: den positiva Pokémon-vakten
  // (som frågar om ett känt setnamn står i titeln) och kanalvalet för en URL vi
  // aldrig sett. Båda är TAXONOMI — några hundra rader, inga produkter — och
  // hämtas här, i det fönster där Neon ändå är vaken.
  const cardSets = await prisma.cardSet.findMany({
    select: { id: true, name: true, series: true, language: true },
  });
  const setNames = cardSets.map((s) => s.name);
  const sets = cardSets.map((s) => ({
    id: s.id,
    name: s.name,
    series: s.series ?? null,
    language: (s.language as string | null) ?? null,
  }));

  // Admin-nekade URL:er. Listan är liten (ägarens "Ta bort") och måste följa med —
  // lanen har ingen DB att slå upp den i.
  const denied = await prisma.deniedListingUrl.findMany({ select: { url: true } });

  const payload: RestockRoutesPayload = {
    at: Date.now(),
    sources,
    routes,
    setNames,
    deniedUrls: denied.map((d) => d.url),
    sets,
  };

  const withSeries = Object.values(routes).filter((r) => r.series).length;
  console.log(
    `[export-routes] ${sources.length} källor, ${Object.keys(routes).length} URL:er ` +
      `(${withSeries} med serie, ${Object.keys(routes).length - withSeries} utan → catch-all; ` +
      `${fromLedger} från huvudboken utan egen offer), ${setNames.length} setnamn, ` +
      `${payload.deniedUrls.length} nekade URL:er.`
  );
  return payload;
}

export async function exportRestockRoutes(
  outFile: string
): Promise<{ sources: number; routes: number } | null> {
  const payload = await buildRestockRoutes();
  if (!payload) return null;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(payload));
  console.log(`[export-routes] → ${outFile}`);
  return { sources: payload.sources.length, routes: Object.keys(payload.routes).length };
}
