/**
 * REVISION AV KATALOGTÄCKNINGEN PER BUTIK.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-catalog-coverage.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-catalog-coverage.ts --db-only
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-catalog-coverage.ts --store=Kortarkivet
 *
 * FRÅGAN som facettsiffran ("NordicTCG 3") INTE svarar på: är butiken dåligt täckt i
 * katalogen, eller har den bara tre varor i lager just nu? Facetten räknar
 * IN_STOCK + prissatt + direkt länk (se services/explore-facets.ts) — tre helt olika
 * fel ger samma nolla, och de har helt olika åtgärder:
 *
 *   FEEDEN ÄR LITEN      → adaptern hittar inte butikens sortiment (kollektionsfilter,
 *                          sidtak, fel URL-djup) → fixa adaptern
 *   FEEDEN → INGA OFFERS → vaktkedjan fäller annonserna (språk, singlar, merch,
 *                          tillbehör) eller matchningen skapar inget → mät VILKEN vakt
 *   OFFERS → INTE I FACETTEN → allt finns, men status är OUT/UNKNOWN, priset saknas
 *                          eller länken är en söklänk → lagersignal eller pris
 *
 * Rapporten mäter alla tre led i samma körning så de går att skilja åt.
 *
 * ⛔ RAPPORT ONLY — inga skrivningar. Fas 1 av runRestockScan är ren HTTP
 *    (`shouldProcess` returnerar alltid false) så Neon bara läses för källistan.
 */
import "./load-env";
import { readFileSync } from "node:fs";
import { StockStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";
import { resolveStockStrategy } from "../src/scrapers/stock-verify";
import {
  classifyForm,
  cleanListingTitle,
  isAccessoryListing,
  isStoreBundleListing,
  isOtherFranchiseListing,
  isMerchandiseListing,
  isSingleCardListing,
} from "../src/scrapers/matching";
import { isBlockedListingLanguage } from "../src/lib/listing-language";
import { isDeniedListingUrl, setDynamicDenylist } from "../src/scrapers/import-denylist";
import { normalizeTitle } from "../src/lib/utils";
import { isSealedCategory } from "../src/lib/product-category";

const onlyStore = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
const dbOnly = process.argv.includes("--db-only");
/**
 * Läs feedarna från en dump (scripts/dump-store-feeds.ts) i stället för att hämta dem
 * igen. 42 butiker per körning är oartigt att upprepa — och 2026-08-14 fick just en
 * sådan upprepad svepning Shopify att 429:a oss, varefter friska butiker såg trasiga ut.
 */
const feedsFile = process.argv.find((a) => a.startsWith("--feeds="))?.slice("--feeds=".length);

/** Samma kedja som ensureListingProduct, men den RAPPORTERAR i stället för att returnera null. */
function rejectionReason(title: string, url: string, category: string | null): string | null {
  if (!category) return "ingen kategori";
  if (!isSealedCategory(category)) return "ej sealed-kategori";
  if (isBlockedListingLanguage(title, url)) return "blockerat språk (CN/KR)";
  if (isDeniedListingUrl(url)) return "denylistad URL";
  const clean = cleanListingTitle(title);
  const form = classifyForm(normalizeTitle(clean));
  if (form === "multipack" || form === "case" || form === "combo" || form === "event") return `form=${form}`;
  if (isAccessoryListing(clean)) return "tillbehör";
  if (isStoreBundleListing(clean)) return "butiksegen bundle";
  if (isOtherFranchiseListing(clean)) return "annan franchise";
  if (isSingleCardListing(clean)) return "enskilt kort";
  if (isMerchandiseListing(clean)) return "merch";
  return null;
}

async function main() {
  const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const sources: RestockSourceInfo[] = active
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .filter((s) => !onlyStore || s.name === onlyStore)
    .map((s) => ({
      name: s.name,
      type: s.type,
      baseUrl: s.baseUrl,
      rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
    }));

  // Admins egna nekade URL:er räknas med, annars överskattar rapporten importbarheten.
  const denied = await prisma.deniedListingUrl.findMany({ select: { url: true } }).catch(() => []);
  setDynamicDenylist(denied.map((d) => d.url));

  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const idByName = new Map(retailers.map((r) => [r.name, r.id]));

  // ---- DB-sidan: offers per butik, uppdelat på exakt facettens tre villkor ----
  type DbStat = {
    offers: number;
    inStock: number;
    priced: number;
    direct: number;
    facet: number;
    staleOffers: number;
    ledger: number;
    ledgerWithProduct: number;
  };
  const dbStats = new Map<string, DbStat>();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);

  for (const src of sources) {
    const retailerId = idByName.get(src.name);
    if (!retailerId) {
      dbStats.set(src.name, { offers: 0, inStock: 0, priced: 0, direct: 0, facet: 0, staleOffers: 0, ledger: 0, ledgerWithProduct: 0 });
      continue;
    }
    const [offers, inStock, priced, direct, facetRows, stale, ledger, ledgerWithProduct] = await Promise.all([
      prisma.offer.count({ where: { retailerId } }),
      prisma.offer.count({ where: { retailerId, stockStatus: StockStatus.IN_STOCK } }),
      prisma.offer.count({ where: { retailerId, price: { not: null } } }),
      prisma.offer.count({ where: { retailerId, NOT: { url: { contains: "search", mode: "insensitive" } } } }),
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(DISTINCT o."productId")::int AS count
        FROM "Offer" o
        WHERE o."retailerId" = ${retailerId}
          AND o."stockStatus"::text = 'IN_STOCK'
          AND o."price" IS NOT NULL
          AND o."url" NOT ILIKE '%search%'`,
      prisma.offer.count({ where: { retailerId, lastSeenAt: { lt: dayAgo } } }),
      prisma.storeListing.count({ where: { retailerId } }),
      prisma.storeListing.count({ where: { retailerId, productId: { not: null } } }),
    ]);
    dbStats.set(src.name, {
      offers,
      inStock,
      priced,
      direct,
      facet: facetRows[0]?.count ?? 0,
      staleOffers: stale,
      ledger,
      ledgerWithProduct,
    });
  }

  if (dbOnly) {
    printDb(sources, dbStats);
    return;
  }

  // ---- Feed-sidan: hämta varje butiks levande feed (ren HTTP) ----
  type FeedStat = {
    items: number;
    importable: number;
    inStock: number;
    outOfStock: number;
    unknown: number;
    reasons: Map<string, number>;
    urls: Set<string>;
  };
  const feedStats = new Map<string, FeedStat>();

  const collect = (fetched: { sourceName: string; items: { url: string; title: string; category: string | null; stockStatus: StockStatus }[] }[]) => {
    for (const f of fetched) {
        const s: FeedStat = {
          items: f.items.length,
          importable: 0,
          inStock: 0,
          outOfStock: 0,
          unknown: 0,
          reasons: new Map(),
          urls: new Set(),
        };
        for (const it of f.items) {
          s.urls.add(it.url);
          if (it.stockStatus === StockStatus.IN_STOCK) s.inStock++;
          else if (it.stockStatus === StockStatus.OUT_OF_STOCK) s.outOfStock++;
          else s.unknown++;
          const reason = rejectionReason(it.title, it.url, it.category ?? null);
          if (reason) s.reasons.set(reason, (s.reasons.get(reason) ?? 0) + 1);
          else s.importable++;
        }
        feedStats.set(f.sourceName, s);
    }
  };

  if (feedsFile) {
    const dumped = JSON.parse(readFileSync(feedsFile, "utf8")) as {
      groups: { sourceName: string; items: { url: string; title: string; category: string | null; stockStatus: StockStatus }[] }[];
    };
    console.log(`[audit] läser feedarna ur dumpen ${feedsFile} (ingen ny hämtning).\n`);
    collect(dumped.groups);
  } else {
    console.log(`[audit] hämtar feed för ${sources.length} butiker...\n`);
    await runRestockScan({
      sources,
      shouldProcess: async (fetched) => {
        collect(fetched);
        return false; // rör aldrig DB-fasen
      },
    });
  }

  // ---- Rapport ----
  console.log("=== TÄCKNING PER BUTIK ===");
  console.log(
    "  feed / importabel  →  offers / i lager  →  FACETT   (butik)"
  );
  const rows = sources
    .map((s) => ({ name: s.name, feed: feedStats.get(s.name), db: dbStats.get(s.name)! }))
    .sort((a, b) => (b.feed?.importable ?? 0) - (a.feed?.importable ?? 0));

  for (const r of rows) {
    const f = r.feed;
    console.log(
      `  ${String(f?.items ?? "?").padStart(5)} / ${String(f?.importable ?? "?").padStart(6)}` +
        `  →  ${String(r.db.offers).padStart(6)} / ${String(r.db.inStock).padStart(6)}` +
        `  →  ${String(r.db.facet).padStart(5)}   ${r.name}`
    );
  }

  console.log("\n=== HÅL: importabla annonser i feeden som saknar offer ===");
  for (const r of rows) {
    const f = r.feed;
    if (!f) continue;
    const gap = f.importable - r.db.offers;
    if (gap > 5) {
      console.log(
        `  ${r.name}: feed har ${f.importable} importabla men bara ${r.db.offers} offers (gap ${gap})` +
          `  [huvudbok: ${r.db.ledger} rader, ${r.db.ledgerWithProduct} bundna]`
      );
    }
  }

  console.log("\n=== VARFÖR ANNONSER FÄLLS (per butik, topp 6) ===");
  for (const r of rows) {
    const f = r.feed;
    if (!f || f.reasons.size === 0) continue;
    const top = [...f.reasons].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`  ${r.name} (${f.items} annonser, ${f.importable} importabla):`);
    for (const [reason, n] of top) console.log(`      ${String(n).padStart(5)}  ${reason}`);
  }

  console.log("\n=== LAGERSIGNAL: butiker vars feed aldrig säger SLUT ===");
  for (const r of rows) {
    const f = r.feed;
    if (f && f.items >= 5 && f.outOfStock === 0) {
      console.log(`  ${r.name}: ${f.items} annonser, ${f.inStock} i lager, 0 slut, ${f.unknown} okänd`);
    }
  }

  // ---- KAN BUTIKEN ÖVER HUVUD TAGET LARMA? ----
  // Frågan ägaren ställde ("den larmar inte för många produkter och butiker") bryts ner i
  // fyra villkor som ALLA måste hålla. Faller ett av dem är butiken tyst — och tystnaden
  // ser likadan ut i alla hälsomått, vilket är varför den kan pågå i månader.
  console.log("\n=== KAN BUTIKEN LARMA? (alla fyra måste vara ✅) ===");
  console.log("  feed  offers  OUT-signal  lagerkoll   butik");
  for (const r of rows) {
    const f = r.feed;
    const hasFeed = (f?.items ?? 0) > 0;
    const hasOffers = r.db.offers > 0;
    // En feed som aldrig säger "slut" kan bara ge "ny produkt i lager", aldrig en
    // restock: OUT→IN inträffar per definition inte.
    const canSayOut = (f?.outOfStock ?? 0) > 0 || !hasFeed;
    // Frånvaro ur feeden kollas mot butikens egen sida. Saknas den vägen faller offern
    // till UNKNOWN, och UNKNOWN→IN_STOCK räknas inte som en övergång ⇒ nästa
    // påfyllning larmar aldrig.
    const sampleUrl = [...(f?.urls ?? [])][0] ?? "";
    const strategy = sampleUrl ? resolveStockStrategy(r.name, sampleUrl) : "none";
    const mark = (ok: boolean) => (ok ? "✅" : "❌");
    if (hasFeed && hasOffers && canSayOut && strategy !== "none") continue; // frisk → tyst
    console.log(
      `  ${mark(hasFeed)}     ${mark(hasOffers)}       ${mark(canSayOut)}          ` +
        `${(strategy === "none" ? "❌ ingen" : `✅ ${strategy}`).padEnd(14)} ${r.name}`
    );
  }
  console.log("  (butiker där alla fyra håller listas inte)");

  console.log("\n=== FACETT-FÖRLUST: offers som finns men inte syns i filtret ===");
  for (const r of rows) {
    const lost = r.db.offers - r.db.facet;
    if (r.db.offers > 0 && lost > 0) {
      console.log(
        `  ${r.name}: ${r.db.offers} offers → ${r.db.facet} i facetten ` +
          `(i lager ${r.db.inStock}, prissatta ${r.db.priced}, direktlänk ${r.db.direct}, ` +
          `inaktuella >24h ${r.db.staleOffers})`
      );
    }
  }
}

function printDb(sources: RestockSourceInfo[], dbStats: Map<string, { offers: number; inStock: number; priced: number; direct: number; facet: number; staleOffers: number; ledger: number; ledgerWithProduct: number }>) {
  console.log("=== DB PER BUTIK ===");
  console.log("  offers / i lager / prissatta / direkt / FACETT / inaktuella>24h / huvudbok(bundna)   butik");
  const rows = sources
    .map((s) => ({ name: s.name, db: dbStats.get(s.name)! }))
    .sort((a, b) => b.db.offers - a.db.offers);
  for (const r of rows) {
    console.log(
      `  ${String(r.db.offers).padStart(6)} ${String(r.db.inStock).padStart(9)} ${String(r.db.priced).padStart(11)} ` +
        `${String(r.db.direct).padStart(8)} ${String(r.db.facet).padStart(8)} ${String(r.db.staleOffers).padStart(15)} ` +
        `${String(r.db.ledger).padStart(10)}(${r.db.ledgerWithProduct})   ${r.name}`
    );
  }
}

main().finally(() => prisma.$disconnect());
