/**
 * Hot-card-refresh: uppdaterar From-priset (engelska NM-lägsta) för de mest
 * relevanta korten FLERA gånger/dygn — utöver den dagliga fulla refreshen
 * (cardmarket-refresh.ts). Ger intradags-färska priser på korten folk faktiskt
 * tittar på, utan att byta priskälla (RapidAPI = enda källan med lowest_near_mint).
 *
 * Per-kort-uppslag `?tcgid={id}` = 1 anrop/kort → ryms i kvotens slack
 * (3000/dygn − ~1100 full refresh). Hetast = mest BEVAKADE + mest VISADE
 * SINGLE_CARD med tcgid + ett Cardmarket-offer. HOT_CARD_LIMIT styr taket.
 *
 * Delas av CLI-wrappern (GitHub Actions) — prishistoriken/grafen rörs INTE.
 */
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { getRatesOre } from "../lib/exchange-rate";
import {
  cardmarketProductUrl,
  isEnglishCardmarketUrl,
  withNearMint,
} from "../lib/marketplace-urls";
import { recomputeProductPriceCache } from "../services/products";
import { clampDayMoves, fetchCmGuide, fromElseTrend, DAY_MOVE_MAX } from "./cardmarket-refresh";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API_CONCURRENCY = 4;
const DB_CONCURRENCY = 8;

interface CmCard {
  cardmarket_id: number | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
}

export interface HotRefreshResult {
  ran: boolean;
  updated: number;
  apiCalls: number;
  remaining: number;
}

type HotProduct = {
  id: string;
  card: { tcgExternalId: string | null } | null;
  offers: { id: string; url: string }[];
};

export async function runHotCardRefresh(
  opts: { limit?: number; throttleMs?: number } = {}
): Promise<HotRefreshResult> {
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
  const limit = opts.limit ?? parseInt(process.env.HOT_CARD_LIMIT ?? "400", 10);
  const throttle = opts.throttleMs ?? 220;
  const res: HotRefreshResult = { ran: false, updated: 0, apiCalls: 0, remaining: Infinity };
  if (!KEY) {
    console.warn("[hot-refresh] CARDMARKET_RAPIDAPI_KEY saknas — hoppar över.");
    return res;
  }
  res.ran = true;

  const api = async <T>(url: string): Promise<T | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
      const rem = r.headers.get("x-ratelimit-requests-remaining");
      if (rem != null) res.remaining = parseInt(rem, 10);
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!r.ok) { console.error(`[hot-refresh] ${r.status} ${url}`); return null; }
      res.apiCalls++;
      return (await r.json()) as T;
    }
    return null;
  };

  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) { console.warn("[hot-refresh] Cardmarket-retailer saknas."); return res; }

  const select = {
    id: true,
    card: { select: { tcgExternalId: true } },
    offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 },
  } as const;
  const baseWhere = {
    category: "SINGLE_CARD" as const,
    card: { tcgExternalId: { not: null } },
    offers: { some: { retailerId: cm.id } },
  };

  // Mest bevakade först (de korten driver pris-/restock-alerts), fyll sedan på
  // med mest visade upp till taket.
  const watched: HotProduct[] = await prisma.product.findMany({
    where: { ...baseWhere, watchlistItems: { some: {} } },
    select,
    orderBy: { watchlistItems: { _count: "desc" } },
    take: limit,
  });
  const seen = new Set(watched.map((p) => p.id));
  const need = limit - watched.length;
  const viewed: HotProduct[] = need > 0
    ? await prisma.product.findMany({
        where: { ...baseWhere, id: { notIn: [...seen] } },
        select,
        orderBy: { viewCount: "desc" },
        take: need,
      })
    : [];
  const hot = [...watched, ...viewed];
  console.log(`[hot-refresh] ${hot.length} kort (${watched.length} bevakade + ${viewed.length} visade), tak ${limit}.`);

  // SAMMA prisregel och vakter som dagliga cardmarket-refresh. Innan 2026-07-24
  // publicerade det här jobbet RÅ lowest_near_mint utan fromElseTrend, utan trend-
  // facit och utan dagvakt — en oskyddad skrivväg rakt in i de ~400 mest bevakade/
  // visade korten varje kväll: en skräp-From (eller en From som dagliga jobbet just
  // ersatt med trend) klobbrade det vaktade priset några timmar senare, och offer
  // och graf visade två olika världar. Guiden är en gratis nedladdning (0 kvot).
  const guide = await fetchCmGuide();
  const ops: { offerId?: string; productId: string; priceOre: number | null; refOre?: number | null; url: string }[] = [];
  await mapPool(hot, API_CONCURRENCY, async (p) => {
    const ext = p.card?.tcgExternalId;
    if (!ext) return;
    const d = await api<{ data: CmCard[] }>(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(ext)}`);
    await sleep(throttle * API_CONCURRENCY);
    const card = d?.data?.[0];
    if (!card) return;
    const cmp = card.prices?.cardmarket ?? {};
    // From bara om rimlig mot CM:s egen trend, annars trend→30d (ägarens prisregel,
    // identisk med singel-fasen i cardmarket-refresh).
    const g = card.cardmarket_id != null ? guide.get(card.cardmarket_id) : undefined;
    const refEur = g?.trend ?? g?.avg ?? null;
    const eur = fromElseTrend(cmp.lowest_near_mint, refEur, g?.avg30 ?? cmp["30d_average"]);
    if (eur == null) return;
    const offer = p.offers[0];
    const url =
      offer?.url && isEnglishCardmarketUrl(offer.url) ? withNearMint(offer.url)
        : card.cardmarket_id != null ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true })
          : offer?.url ?? null;
    if (!url) return;
    ops.push({
      offerId: offer?.id, productId: p.id,
      priceOre: Math.round(eur * rates.eurToOre),
      refOre: refEur != null && refEur > 0 ? Math.round(refEur * rates.eurToOre) : null,
      url,
    });
  });

  // Dagvakt med heal-referens (CM-trend) — samma som dagliga jobbet, så kvälls-
  // skrivningen aldrig kan återinföra ett hopp som 13:00-körningen redan vaktat bort.
  const guard = await clampDayMoves(ops);
  if (guard.clamped) console.log(`[hot-refresh] klämde ${guard.clamped} orimliga dagshopp (≥${DAY_MOVE_MAX}x) till gårdagens värde.`);
  if (guard.healed) console.log(`[hot-refresh] LÄKTE ${guard.healed} tidigare korrupta priser (stort hopp mot CM-trend).`);

  await mapPool(ops, DB_CONCURRENCY, async (op) => {
    if (op.priceOre == null) return; // vaktad bort — rör inte offern
    if (op.offerId) {
      await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: "IN_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() } });
    } else {
      await prisma.offer.upsert({
        where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
        update: { price: op.priceOre, url: op.url, stockStatus: "IN_STOCK", lastSeenAt: new Date() },
        create: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: "IN_STOCK", url: op.url },
      });
    }
    res.updated++;
  });

  if (res.updated > 0) await recomputeProductPriceCache();
  console.log(`[hot-refresh] ${res.updated} kort uppdaterade, ${res.apiCalls} anrop (kvot kvar ${res.remaining}).`);
  return res;
}
