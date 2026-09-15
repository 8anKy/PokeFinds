/**
 * GRADERADE BEGÄRDA PRISER — svepet (eBay Browse, gratis).
 *
 * EN sökning per kort ⇒ de billigaste aktiva graderade annonserna, bucketade
 * per (bolag, betyg) i `lib/graded-ask.ts`, skrivna som ETT TILLSTÅND per grupp
 * i `GradedAsk` (upsert + radera det som inte längre finns). Ingen historik.
 *
 * ⛔ BEGÄRT ÄR INTE SÅLT — det här är en andra tabell bredvid `GradedSale`, och
 * UI:t skriver "till salu", aldrig "värde". Se `.claude/rules/marketplace-tradera.md`.
 *
 * URVALET ÄR EN ROTATION MED FÖRTUR: bevakade kort först (det är de folk tittar
 * på), därefter aldrig/äldst svepta med flest visningar. Kvoten (`EBAY_GRADED_
 * DAILY_BUDGET`, default 4 000 av eBays ~5 000) är kort per dygn ⇒ hela katalogen
 * (~25 600 singlar EN+JP) varvas på ~en vecka, bevakade varje natt. Rader äldre
 * än `GRADED_ASK_MAX_AGE_DAYS` döljs av läsmodellen — en rotation som halkar
 * efter visar då "–", aldrig ett tre veckor gammalt begärt pris.
 *
 * ⛔ STEG I NATTKEDJAN (tradera-sold-sync.yml), aldrig egen cron — Neon är redan
 * vaken i det fönstret och en extra väckning kostar ≥ 300 s. DB-arbetet är
 * litet: en läsning för urvalet, en upsert-batch per kort med träffar.
 *
 * ⛔ 429 ⇒ SKRIV DET SOM HANN OCH SLUTA. Kvoten återställs vid midnatt Pacific.
 */
import { prisma } from "../lib/db";
import type { Prisma } from "@prisma/client";
import { mapPool } from "../lib/concurrency";
import { utcToday } from "../lib/utils";
import { getRatesOre, priceOreFromUsd, priceOreFromEur } from "../lib/exchange-rate";
import { isPlausibleGradedPriceOre } from "../lib/graded-listing";
import {
  EBAY_ASK_SOURCE,
  buildGradedSearchQuery,
  bucketGradedAsks,
  type GradedAskBucket,
  type GradedAskProduct,
} from "../lib/graded-ask";
import { EbayQuotaError, ebayClientFromEnv, type EbayBrowseClient } from "../lib/ebay-browse";

/** Samtidiga eBay-anrop. Kvoten är per dygn, inte per sekund — men var artig. */
const API_CONCURRENCY = 2;
const THROTTLE_MS = 150;

export interface GradedAskSweepOptions {
  dryRun?: boolean;
  /** Max antal kort (= eBay-anrop) i den här körningen. */
  budget?: number;
  client?: EbayBrowseClient | null;
}

export interface GradedAskSweepResult {
  ran: boolean;
  products: number;
  apiCalls: number;
  /** Kort med minst en rad efter vakterna. */
  withAsks: number;
  rowsWritten: number;
  rowsDeleted: number;
  implausible: number;
  quotaHit: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ProductRow = GradedAskProduct & { cmRefOre: number | null };

/**
 * Urvalet: bevakade först, sedan rotation (aldrig svept → äldst svept), flest
 * visningar som tiebreaker. Bara singlar med kortnummer — sealed har inget
 * betyg, och utan nummer kan ingen träff bevisa sig.
 */
async function selectProducts(budget: number): Promise<ProductRow[]> {
  const select = {
    id: true,
    language: true,
    variantLabel: true,
    card: { select: { name: true, number: true, set: { select: { name: true, totalCards: true } } } },
    offers: {
      where: { retailer: { name: "Cardmarket" }, price: { not: null } },
      select: { price: true },
      take: 1,
    },
  } satisfies Prisma.ProductSelect;
  const baseWhere: Prisma.ProductWhereInput = {
    category: "SINGLE_CARD",
    hiddenAt: null,
    cardId: { not: null },
    language: { in: ["EN", "JP"] },
  };
  const watched = await prisma.product.findMany({
    where: { ...baseWhere, watchlistItems: { some: {} } },
    select,
    orderBy: [{ watchlistItems: { _count: "desc" } }, { viewCount: "desc" }],
    take: budget,
  });
  const seen = new Set(watched.map((p) => p.id));
  const need = budget - watched.length;
  const rotation = need > 0
    ? await prisma.product.findMany({
        where: { ...baseWhere, id: { notIn: [...seen] } },
        select,
        orderBy: [{ gradedAskCheckedAt: { sort: "asc", nulls: "first" } }, { viewCount: "desc" }],
        take: need,
      })
    : [];
  console.log(
    `[graded-ask] ${watched.length + rotation.length} kort (${watched.length} bevakade + ${rotation.length} rotation), budget ${budget}.`
  );
  return [...watched, ...rotation]
    .filter((p): p is typeof p & { card: NonNullable<typeof p.card> } => p.card != null)
    .map((p) => ({
      id: p.id,
      language: p.language,
      variantLabel: p.variantLabel,
      card: p.card,
      cmRefOre: p.offers[0]?.price ?? null,
    }));
}

export async function runGradedAskSweep(
  opts: GradedAskSweepOptions = {}
): Promise<GradedAskSweepResult> {
  const res: GradedAskSweepResult = {
    ran: false, products: 0, apiCalls: 0, withAsks: 0,
    rowsWritten: 0, rowsDeleted: 0, implausible: 0, quotaHit: false,
  };
  const client = opts.client === undefined ? ebayClientFromEnv() : opts.client;
  if (!client) {
    console.warn("[graded-ask] EBAY_CLIENT_ID/EBAY_CLIENT_SECRET saknas — hoppar över.");
    return res;
  }
  res.ran = true;
  const budget = opts.budget ?? parseInt(process.env.EBAY_GRADED_DAILY_BUDGET ?? "4000", 10);
  const dryRun = opts.dryRun ?? false;

  // Kursen EN gång per körning (ingest-regeln). USD är normalfallet (EBAY_US);
  // EUR tas med för EBAY_DE och liknande. Annat ⇒ raden hoppas över — vi gissar
  // aldrig en kurs.
  const rates = await getRatesOre();
  const toOre = (amount: number, currency: string): number | null => {
    if (currency === "USD") return priceOreFromUsd(amount, rates);
    if (currency === "EUR") return priceOreFromEur(amount, rates);
    if (currency === "SEK") {
      const ore = Math.round(amount * 100);
      return ore > 0 ? ore : null;
    }
    return null;
  };

  const products = await selectProducts(budget);
  res.products = products.length;
  const now = new Date();
  const today = utcToday();
  let stop = false;

  await mapPool(products, API_CONCURRENCY, async (p) => {
    if (stop) return;
    let buckets: GradedAskBucket[];
    try {
      const items = await client.searchGraded(buildGradedSearchQuery(p));
      res.apiCalls++;
      buckets = bucketGradedAsks(items, p);
    } catch (err) {
      if (err instanceof EbayQuotaError) {
        if (!stop) console.warn("[graded-ask] eBay-kvoten slut — avslutar och skriver det som hann.");
        stop = true;
        res.quotaHit = true;
        return;
      }
      console.error(`[graded-ask] ${p.card.name} ${p.card.number}: ${err instanceof Error ? err.message : err}`);
      return;
    } finally {
      await sleep(THROTTLE_MS);
    }

    const rows = buckets.flatMap((b) => {
      const priceOre = toOre(b.amount, b.currency);
      if (priceOre == null) return [];
      // Samma undre vakt som sålt-serien: ett graderat kort under 15 % av det
      // ograderade CM-priset är en felmatchning, inte ett fynd. Ingen övre gräns.
      if (!isPlausibleGradedPriceOre(p.cmRefOre, priceOre)) {
        res.implausible++;
        return [];
      }
      return [{
        productId: p.id,
        source: EBAY_ASK_SOURCE,
        issuer: b.issuer,
        gradeTenths: b.gradeTenths,
        priceOre,
        originalMinor: Math.round(b.amount * 100),
        originalCurrency: b.currency,
        listingCount: b.listingCount,
        url: b.url,
        title: b.title,
        itemId: b.itemId,
        observedAt: now,
      }];
    });
    if (rows.length > 0) res.withAsks++;

    if (dryRun) {
      for (const r of rows) {
        console.log(`  ${p.card.name} ${p.card.number} — ${r.issuer} ${r.gradeTenths / 10}: ${(r.priceOre / 100).toFixed(0)} kr (${r.listingCount} st) ${r.url}`);
      }
      return;
    }

    // ETT TILLSTÅND: skriv över grupperna vi såg, radera de vi inte såg.
    const keep = rows.map((r) => `${r.issuer}|${r.gradeTenths}`);
    const ops = [
      prisma.gradedAsk.deleteMany({
        where: {
          productId: p.id,
          source: EBAY_ASK_SOURCE,
          ...(keep.length > 0
            ? { NOT: { OR: rows.map((r) => ({ issuer: r.issuer, gradeTenths: r.gradeTenths })) } }
            : {}),
        },
      }),
      ...rows.map((r) =>
        prisma.gradedAsk.upsert({
          where: {
            productId_source_issuer_gradeTenths: {
              productId: r.productId, source: r.source, issuer: r.issuer, gradeTenths: r.gradeTenths,
            },
          },
          create: r,
          update: r,
        })
      ),
      // HISTORIKEN: en punkt per grupp och UTC-dygn (upsert — en omkörning samma
      // dygn skriver över, aldrig dubblar). Grafen "PSA 10 · prishistorik" ritas
      // härifrån; tillståndet ovan är bara "just nu".
      ...rows.map((r) =>
        prisma.gradedAskSnapshot.upsert({
          where: {
            productId_source_issuer_gradeTenths_date: {
              productId: r.productId, source: r.source, issuer: r.issuer, gradeTenths: r.gradeTenths, date: today,
            },
          },
          create: {
            productId: r.productId, source: r.source, issuer: r.issuer, gradeTenths: r.gradeTenths,
            date: today, priceOre: r.priceOre, listingCount: r.listingCount,
          },
          update: { priceOre: r.priceOre, listingCount: r.listingCount },
        })
      ),
      prisma.product.update({ where: { id: p.id }, data: { gradedAskCheckedAt: now } }),
    ];
    const [del] = await prisma.$transaction(ops);
    res.rowsDeleted += (del as { count: number }).count;
    res.rowsWritten += rows.length;
  });

  console.log(
    `[graded-ask] klart: ${res.apiCalls} anrop, ${res.withAsks}/${res.products} kort med rader, ` +
      `${res.rowsWritten} skrivna, ${res.rowsDeleted} raderade, ${res.implausible} orimliga` +
      (res.quotaHit ? ", KVOT SLUT" : "") + (dryRun ? " (dry run)" : "")
  );
  return res;
}
