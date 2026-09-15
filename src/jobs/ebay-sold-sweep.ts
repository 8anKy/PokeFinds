/**
 * SVEP: GRADERADE SÅLDA PÅ EBAY → GradedSale (source "ebay"). 2026-09-15.
 *
 * Källa: prisleverantörens `/{game}/ebay-sold-offers?tcgid=…` (eBay UK:s
 * avslutade graderade annonser, redan matchade per kort). EN ANROP PER KORT,
 * en sida (max 100 affärer) — det räcker för medianer och grafens punkter.
 * Delar RapidAPI-kvoten med Cardmarket-priserna (~2 300/dygn av 15 000 sedan
 * Ultra 2026-09-16), därför en EGEN budget (`TCGGO_EBAY_SOLD_DAILY_BUDGET`,
 * default 2 000 — hela EN-katalogen varvas på ~10 dygn).
 *
 * Urval som graded-ask-sweep: bevakade kort varje natt, resten roterar på
 * `Product.ebaySoldCheckedAt`. Idempotent: `GradedSale.itemId` är unik och
 * createMany hoppar dubbletter — en omkörning kostar bara anropen.
 *
 * ⛔ EN-kort bär pokemontcg-id i `Card.tcgExternalId` → `tcgid=`. JP-kort bär
 *    leverantörens eget id ("tcggo-jp:<id>") → `id=` mot `pokemon-jp` (Ultra
 *    sedan 2026-09-16).
 * ⛔ 429 = kvoten slut: stanna, skriv det som hann.
 * ⛔ Plausibilitetsvakten är samma som Tradera-vägen: under 15 % av det
 *    ograderade CM-priset är en felmatchning, inte ett fynd.
 * ⛔ LEVERANTÖRENS MATCHNING ÄR LÖS (mätt i första torrkörningen 09-15: EN
 *    Charmander 168 fick japanska "sv2a 151"-affärer). Varje rad måste därför
 *    BEVISA sig som i ask-svepet: språk, nummer, set och tryckning ur TITELN.
 */
import { prisma } from "../lib/db";
import type { Prisma } from "@prisma/client";
import { mapPool } from "../lib/concurrency";
import { getRatesOre } from "../lib/exchange-rate";
import { isPlausibleGradedPriceOre } from "../lib/graded-listing";
import { EBAY_SOLD_SOURCE, mapEbaySoldOffer, type EbaySoldOffer } from "../lib/ebay-sold";
import { titleCarriesNumber, titleFitsSet, type GradedAskProduct } from "../lib/graded-ask";
import { listingCardLanguage } from "../lib/listing-language";
import { listingFitsVariant } from "../lib/print-variant";
import { JP_EXTERNAL_PREFIX } from "./jp-singles-refresh";

const THROTTLE_MS = 120;
const PER_PAGE = 100;

export interface EbaySoldSweepOptions {
  budget?: number;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

export interface EbaySoldSweepResult {
  ran: boolean;
  products: number;
  apiCalls: number;
  withSales: number;
  rowsWritten: number;
  implausible: number;
  quotaHit: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ProductRow extends GradedAskProduct {
  externalId: string;
  cmRefOre: number | null;
}

async function selectProducts(budget: number): Promise<ProductRow[]> {
  const select = {
    id: true,
    language: true,
    variantLabel: true,
    card: { select: { tcgExternalId: true, name: true, number: true, set: { select: { name: true, totalCards: true } } } },
    offers: { where: { retailer: { name: "Cardmarket" }, price: { not: null } }, select: { price: true }, take: 1 },
  } satisfies Prisma.ProductSelect;
  const baseWhere: Prisma.ProductWhereInput = {
    category: "SINGLE_CARD",
    hiddenAt: null,
    card: { tcgExternalId: { not: null } },
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
        orderBy: [{ ebaySoldCheckedAt: { sort: "asc", nulls: "first" } }, { viewCount: "desc" }],
        take: need,
      })
    : [];
  console.log(
    `[ebay-sold] ${watched.length + rotation.length} kort (${watched.length} bevakade + ${rotation.length} rotation), budget ${budget}.`
  );
  return [...watched, ...rotation]
    .filter((p) => p.card?.tcgExternalId)
    .map((p) => ({
      id: p.id,
      language: p.language,
      variantLabel: p.variantLabel,
      card: { name: p.card!.name, number: p.card!.number, set: p.card!.set },
      externalId: p.card!.tcgExternalId!,
      cmRefOre: p.offers[0]?.price ?? null,
    }));
}

class QuotaError extends Error {}

export async function runEbaySoldSweep(opts: EbaySoldSweepOptions = {}): Promise<EbaySoldSweepResult> {
  const res: EbaySoldSweepResult = {
    ran: false, products: 0, apiCalls: 0, withSales: 0, rowsWritten: 0, implausible: 0, quotaHit: false,
  };
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST;
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY;
  if (!HOST || !KEY) {
    console.warn("[ebay-sold] CARDMARKET_RAPIDAPI_HOST/KEY saknas — hoppar över.");
    return res;
  }
  res.ran = true;
  const budget = opts.budget ?? parseInt(process.env.TCGGO_EBAY_SOLD_DAILY_BUDGET ?? "2000", 10);
  const dryRun = opts.dryRun ?? false;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rates = await getRatesOre();

  const products = await selectProducts(budget);
  res.products = products.length;
  const now = new Date();
  let stop = false;

  await mapPool(products, 2, async (p) => {
    if (stop) return;
    const query = p.externalId.startsWith(JP_EXTERNAL_PREFIX)
      ? `id=${encodeURIComponent(p.externalId.slice(JP_EXTERNAL_PREFIX.length))}`
      : `tcgid=${encodeURIComponent(p.externalId)}`;
    const game = p.language === "JP" ? "pokemon-jp" : "pokemon";
    let offers: EbaySoldOffer[];
    try {
      const r = await fetchImpl(`https://${HOST}/${game}/ebay-sold-offers?${query}&per_page=${PER_PAGE}`, {
        headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
      });
      res.apiCalls++;
      if (r.status === 429) throw new QuotaError("429");
      if (!r.ok) {
        console.warn(`[ebay-sold] ${p.externalId}: HTTP ${r.status}`);
        return;
      }
      offers = ((await r.json()) as { data?: EbaySoldOffer[] }).data ?? [];
    } catch (err) {
      if (err instanceof QuotaError) {
        stop = true;
        res.quotaHit = true;
        return;
      }
      console.error(`[ebay-sold] ${p.externalId}: ${err instanceof Error ? err.message : err}`);
      return;
    } finally {
      await sleep(THROTTLE_MS);
    }

    const rows = offers.flatMap((o) => {
      // Bevisvakterna FÖRE priset: fel språk/nummer/set/tryckning är inte en affär
      // för DEN här produkten, oavsett hur rimligt priset ser ut.
      const title = o.title ?? "";
      if (listingCardLanguage(title) !== p.language) return [];
      if (!titleCarriesNumber(title, p.card.number)) return [];
      if (!titleFitsSet(title, p)) return [];
      if (!listingFitsVariant(p.variantLabel, title, p.card.name)) return [];
      const m = mapEbaySoldOffer(o, rates);
      if (!m) return [];
      if (!isPlausibleGradedPriceOre(p.cmRefOre, m.price)) {
        res.implausible++;
        return [];
      }
      return [{
        productId: p.id,
        itemId: m.itemId,
        issuer: m.issuer,
        gradeTenths: m.gradeTenths,
        price: m.price,
        currency: "SEK",
        language: p.language,
        title: m.title,
        url: m.url,
        soldAt: m.soldAt,
        bidCount: null,
        verify: "tcggo-ebay-sold",
        source: EBAY_SOLD_SOURCE,
      }];
    });
    if (rows.length > 0) res.withSales++;

    if (dryRun) {
      for (const r of rows.slice(0, 5)) {
        console.log(`  ${p.externalId} — ${r.issuer} ${r.gradeTenths / 10}: ${(r.price / 100).toFixed(0)} kr ${r.soldAt.toISOString().slice(0, 10)} ${r.title.slice(0, 60)}`);
      }
      return;
    }
    const [created] = await prisma.$transaction([
      prisma.gradedSale.createMany({ data: rows, skipDuplicates: true }),
      prisma.product.update({ where: { id: p.id }, data: { ebaySoldCheckedAt: now } }),
    ]);
    res.rowsWritten += created.count;
  });

  console.log(
    `[ebay-sold] klart: ${res.apiCalls} anrop, ${res.withSales}/${res.products} kort med affärer, ` +
      `${res.rowsWritten} nya rader, ${res.implausible} orimliga` +
      (res.quotaHit ? ", KVOT SLUT" : "") + (dryRun ? " (dry run)" : "")
  );
  return res;
}
