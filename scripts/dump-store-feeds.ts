/**
 * Dumpar varje restock-bevakad butiks LEVANDE feed till en JSON-fil.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/dump-store-feeds.ts [--out=feeds.json]
 *
 * VARFÖR: klassificerings- och vaktregler måste MÄTAS mot riktiga butikstitlar innan de
 * ändras (regeln sedan Webhallen-misstaget 2026-08-14). Att hämta 42 butikers feedar en
 * gång per regeländring är både långsamt och oartigt — butikernas servrar betalar för
 * vår iteration. Dumpa en gång, iterera offline hur många gånger som helst.
 *
 * ⛔ RÖR INTE DB:N annat än för källistan (fas 1 av runRestockScan är ren HTTP).
 * ⚠️ Kör LUGNT: RESTOCK_SCAN_CONCURRENCY=4 räcker. 42 butiker på en gång får Shopify
 *    att 429:a (dokumenterat 2026-08-14) och då ser friska butiker trasiga ut.
 */
import "./load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "../src/lib/db";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "feeds.json";

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

  // Offer-URL:erna följer med i dumpen så offline-analysen kan svara på "har den redan
  // en offer?" utan att fråga databasen igen.
  const retailers = await prisma.retailer.findMany({
    where: { name: { in: sources.map((s) => s.name) } },
    select: { id: true, name: true },
  });
  const offers = await prisma.offer.findMany({
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    select: { url: true, retailerId: true, stockStatus: true },
  });
  const nameById = new Map(retailers.map((r) => [r.id, r.name]));
  const offerUrls = offers.map((o) => `${nameById.get(o.retailerId) ?? o.retailerId}\t${o.url}`);

  const denied = await prisma.deniedListingUrl.findMany({ select: { url: true } }).catch(() => []);
  const setNames = (await prisma.cardSet.findMany({ select: { name: true } })).map((r) => r.name);

  const groups: { sourceName: string; items: unknown[] }[] = [];
  await runRestockScan({
    sources,
    shouldProcess: async (fetched) => {
      for (const f of fetched) groups.push({ sourceName: f.sourceName, items: f.items });
      return false;
    },
  });

  mkdirSync(dirname(out) || ".", { recursive: true });
  writeFileSync(out, JSON.stringify({ at: Date.now(), groups, offerUrls, denied: denied.map((d) => d.url), setNames }));
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  console.log(`[dump] ${groups.length} butiker, ${total} annonser, ${offerUrls.length} offers → ${out}`);
}

main().finally(() => prisma.$disconnect());
