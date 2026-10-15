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
import { inIdOrder, selectGradedSweepIds } from "./graded-sweep-select";
import { prisma } from "../lib/db";
import type { Prisma } from "@prisma/client";
import { mapPool } from "../lib/concurrency";
import { getRatesOre } from "../lib/exchange-rate";
import { gradedTooSoonAfterRelease, isPlausibleGradedPriceOre } from "../lib/graded-listing";
import { EBAY_SOLD_SOURCE, mapEbaySoldOffer, type EbaySoldOffer } from "../lib/ebay-sold";
import { titleCarriesNumber, titleFitsSet, type GradedAskProduct } from "../lib/graded-ask";
import { listingCardLanguage } from "../lib/listing-language";
import { listingFitsVariant } from "../lib/print-variant";
import { JP_EXTERNAL_PREFIX } from "./jp-singles-refresh";
import { GRADED_WINDOW_DAYS } from "../services/graded";

const THROTTLE_MS = 120;
const PER_PAGE = 100;
/**
 * ALLA SIDOR, INTE BARA DEN FÖRSTA (2026-10-12). Svepet läste en sida (≤ 100 affärer)
 * per kort, och leverantören sorterar nyast först — så historiken var en tunn skiva:
 * Umbreon VMAX 215 har 509 affärer på 6 sidor (tillbaka till sept 2025) och vi hade 100
 * (≈ 5 veckor); Charizard ex 151 #199 har ~1 800 på 18 sidor och vi hade EN VECKA.
 * Nu bläddras det bakåt tills affärerna passerar GRADED_WINDOW_DAYS (grafens år), sidorna
 * tar slut, taket nås, eller — vid ett återbesök — en sida inte gav något nytt och
 * kortets historik redan når fönstret. Ett avbrutet bakåtbläddrande fortsätter alltså
 * nästa gång kortet roterar in.
 */
const MAX_PAGES_PER_CARD = Number(process.env.TCGGO_EBAY_SOLD_MAX_PAGES) || 20;

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
    card: { select: { tcgExternalId: true, name: true, number: true, set: { select: { name: true, totalCards: true, releaseDate: true } } } },
    offers: { where: { retailer: { name: "Cardmarket" }, price: { not: null } }, select: { price: true }, take: 1 },
  } satisfies Prisma.ProductSelect;
  const baseWhere: Prisma.ProductWhereInput = {
    category: "SINGLE_CARD",
    hiddenAt: null,
    card: { tcgExternalId: { not: null } },
    language: { in: ["EN", "JP"] },
  };
  // Nivåindelat urval (bevakade/ägda → heta → värdefulla → svans), se graded-sweep-select.ts.
  const ids = await selectGradedSweepIds({ baseWhere, field: "ebaySoldCheckedAt", budget, tag: "ebay-sold" });
  const picked = inIdOrder(ids, await prisma.product.findMany({ where: { id: { in: ids } }, select }));
  return picked
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
  // Anropstak för hela körningen (sidor, inte kort). Ultra = 15 000/dygn, CM-jobben ~3 000.
  const callBudget = parseInt(process.env.TCGGO_EBAY_SOLD_CALL_BUDGET ?? "5000", 10);
  const cutoffMs = Date.now() - GRADED_WINDOW_DAYS * 86_400_000;
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
    // Vad vi redan har: id:n (sluta när en sida inte ger något nytt) och hur långt
    // bakåt historiken når (har bakåtbläddrandet en gång gått hela vägen?).
    const known = dryRun
      ? []
      : await prisma.gradedSale.findMany({
          where: { productId: p.id, source: EBAY_SOLD_SOURCE },
          select: { itemId: true, soldAt: true },
        });
    const knownIds = new Set(known.map((k) => k.itemId));
    const reachesWindow = known.some((k) => k.soldAt.getTime() <= cutoffMs + 14 * 86_400_000);
    const offers: EbaySoldOffer[] = [];
    let fetchedAny = false;
    for (let page = 1; page <= MAX_PAGES_PER_CARD; page++) {
      if (stop || res.apiCalls >= callBudget) break;
      let data: EbaySoldOffer[];
      let totalPages = 1;
      try {
        const r = await fetchImpl(
          `https://${HOST}/${game}/ebay-sold-offers?${query}&per_page=${PER_PAGE}&page=${page}`,
          { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } }
        );
        res.apiCalls++;
        if (r.status === 429) throw new QuotaError("429");
        if (!r.ok) {
          console.warn(`[ebay-sold] ${p.externalId} sida ${page}: HTTP ${r.status}`);
          break;
        }
        const body = (await r.json()) as { data?: EbaySoldOffer[]; paging?: { total?: number } };
        data = body.data ?? [];
        totalPages = body.paging?.total ?? 1;
      } catch (err) {
        if (err instanceof QuotaError) {
          stop = true;
          res.quotaHit = true;
          break;
        }
        console.error(`[ebay-sold] ${p.externalId}: ${err instanceof Error ? err.message : err}`);
        break;
      } finally {
        await sleep(THROTTLE_MS);
      }
      fetchedAny = true;
      offers.push(...data);
      if (data.length === 0 || page >= totalPages) break;
      // Sidan passerade grafens år — äldre affärer visas aldrig.
      const oldest = Math.min(...data.map((o) => Date.parse(o.ended_at ?? "") || Infinity));
      if (oldest < cutoffMs) break;
      // Återbesök: inget nytt på sidan OCH historiken når redan fönstret ⇒ ikapp.
      const anyNew = data.some((o) => !knownIds.has(`${EBAY_SOLD_SOURCE}:${o.ebay_item_id}`));
      if (!anyNew && reachesWindow) break;
    }
    if (!fetchedAny) return;

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
      // ⛔ Såld innan kortet hunnit graderas = ett rått kort med betyg i titeln.
      if (gradedTooSoonAfterRelease(p.card.set.releaseDate, m.soldAt)) return [];
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
