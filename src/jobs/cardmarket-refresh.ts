/**
 * Automatisk Cardmarket-prisuppdatering via CardMarket API TCG (RapidAPI Pro).
 * Körs EN gång/dygn (Pro = 3000 anrop/dygn; en full körning ~1100 anrop).
 *
 * - Singlar: engelska NM-lägsta "From" (`lowest_near_mint`) EXAKT (matchar CM 1:1,
 *   ingen utjämning) × live-kurs. Matchas mot vår DB via tcgid = Card.tcgExternalId.
 * - Sealed: CM lägsta (`lowest`) för rätt-matchad produkt (set+form+namnlikhet).
 *
 * Delas av jobb-schemaläggaren (worker.ts/instrumentation) och CLI-wrappers.
 * Prishistoriken/grafen (CM trend) rörs INTE — bara Offer.price.
 */
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { getRatesOre } from "../lib/exchange-rate";
import {
  cardmarketProductUrl,
  isEnglishCardmarketUrl,
  withNearMint,
} from "../lib/marketplace-urls";
import { classifyForm, scoreSimilarity } from "../scrapers/matching";
import { recomputeProductPriceCache } from "../services/products";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Samtidiga DB-skrivningar (≤ DB_POOL i db.ts). Kortar 18k sekventiella
// cross-region-uppdateringar från ~30 min till några minuter.
const DB_CONCURRENCY = 8;
// Samtidiga API-sidhämtningar. Döljer nätverkslatens (US-runner → RapidAPI)
// utan att överskrida 300/min: varje task sover throttle×API_CONCURRENCY.
const API_CONCURRENCY = 4;

interface CmCard {
  tcgid: string | null;
  cardmarket_id: number | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
}
interface ApiProduct {
  name: string;
  cardmarket_id: number | null;
  image?: string;
  prices?: { cardmarket?: { lowest?: number | null; "30d_average"?: number | null; available_items?: number | null } | null } | null;
  episode?: { name?: string } | null;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const EXPECTED_FORM: Record<string, string> = {
  BOOSTER_BOX: "display", BOOSTER_PACK: "booster", ETB: "etb",
  BUNDLE: "bundle", COLLECTION_BOX: "collection", BLISTER: "blister", TIN: "tin",
};

export interface CmRefreshResult {
  ran: boolean;
  singlesUpdated: number;
  singlesCreated: number;
  sealedUpdated: number;
  apiCalls: number;
  remaining: number;
}

export async function runCardmarketRefresh(
  opts: { singles?: boolean; sealed?: boolean; throttleMs?: number } = {}
): Promise<CmRefreshResult> {
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
  const throttle = opts.throttleMs ?? 220;
  const res: CmRefreshResult = { ran: false, singlesUpdated: 0, singlesCreated: 0, sealedUpdated: 0, apiCalls: 0, remaining: Infinity };
  if (!KEY) {
    console.warn("[cm-refresh] CARDMARKET_RAPIDAPI_KEY saknas — hoppar över.");
    return res;
  }
  res.ran = true;

  const api = async <T>(url: string): Promise<T | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
      const rem = r.headers.get("x-ratelimit-requests-remaining");
      if (rem != null) res.remaining = parseInt(rem, 10);
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!r.ok) { console.error(`[cm-refresh] ${r.status} ${url}`); return null; }
      res.apiCalls++;
      return (await r.json()) as T;
    }
    return null;
  };

  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) { console.warn("[cm-refresh] Cardmarket-retailer saknas."); return res; }

  if (opts.singles !== false) {
    const products = await prisma.product.findMany({
      where: { category: "SINGLE_CARD", card: { tcgExternalId: { not: null } } },
      select: { id: true, card: { select: { tcgExternalId: true } }, offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 } },
    });
    const map = new Map<string, { productId: string; offerId?: string; url?: string }>();
    for (const p of products) {
      const ext = p.card?.tcgExternalId;
      if (ext) map.set(ext, { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url });
    }

    // Promo-/specialset utan pokemontcg.io-tcgid (t.ex. MEP Black Star Promos) →
    // matchas på cardmarket_id istället.
    const cmidMap = new Map<number, { productId: string; offerId?: string; url?: string }>();
    const cmidProducts = await prisma.product.findMany({
      where: { category: "SINGLE_CARD", card: { cardmarketId: { not: null }, tcgExternalId: null } },
      select: { id: true, card: { select: { cardmarketId: true } }, offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 } },
    });
    for (const p of cmidProducts) {
      const id = p.card?.cardmarketId;
      if (id != null) cmidMap.set(id, { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url });
    }

    const eps: { id: number; cards_total: number }[] = [];
    let page = 1, total = 1;
    do {
      const d = await api<{ data: { id: number; cards_total: number }[]; paging: { total: number } }>(`https://${HOST}/pokemon/episodes?page=${page}`);
      if (!d) break;
      total = d.paging.total;
      eps.push(...d.data);
      await sleep(throttle);
    } while (page++ < total);

    // Fas 1: hämta priser. Hämtningen är latensbunden (US-runner → RapidAPI, en
    // sida i taget tar ~38 min). Kör API_CONCURRENCY sidor parallellt men låt
    // varje task sova throttle×API_CONCURRENCY → aggregerad takt ≤ 1/throttle
    // (~273/min, under 300/min-kvoten) oavsett latens. Fas 2: skriv samtidigt.
    const pageTasks: { epId: number; pg: number }[] = [];
    for (const ep of eps.filter((e) => e.cards_total > 0)) {
      for (let pg = 1; pg <= Math.ceil(ep.cards_total / 20); pg++) pageTasks.push({ epId: ep.id, pg });
    }
    // MEP Black Star Promos (412) rapporterar cards_total=0 i episode-listan
    // (tcggo-metadata-bugg) men har ~93 kort → force-hämta dess sidor; matchas
    // på cardmarket_id nedan. Tomma sidor returnerar inget (ofarligt).
    if (cmidMap.size > 0) for (let pg = 1; pg <= 6; pg++) pageTasks.push({ epId: 412, pg });
    const singleOps: { productId: string; offerId?: string; priceOre: number; url: string }[] = [];
    await mapPool(pageTasks, API_CONCURRENCY, async ({ epId, pg }) => {
      const d = await api<{ data: CmCard[] }>(`https://${HOST}/pokemon/episodes/${epId}/cards?page=${pg}`);
      await sleep(throttle * API_CONCURRENCY);
      if (!d) return;
      for (const card of d.data) {
        const entry =
          (card.tcgid ? map.get(card.tcgid) : undefined) ??
          (card.cardmarket_id != null ? cmidMap.get(card.cardmarket_id) : undefined);
        if (!entry) continue;
        const cmp = card.prices?.cardmarket ?? {};
        const eur = cmp.lowest_near_mint ?? cmp["30d_average"] ?? null; // exakt From; fallback snitt om From saknas
        if (eur == null) continue;
        const priceOre = Math.round(eur * rates.eurToOre);
        const url =
          entry.url && isEnglishCardmarketUrl(entry.url) ? withNearMint(entry.url)
            : card.cardmarket_id != null ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true })
              : entry.url ?? null;
        if (!url) continue;
        singleOps.push({ productId: entry.productId, offerId: entry.offerId, priceOre, url });
      }
    });
    await mapPool(singleOps, DB_CONCURRENCY, async (op) => {
      if (op.offerId) {
        await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: "IN_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() } });
        res.singlesUpdated++;
      } else {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
          update: { price: op.priceOre, url: op.url, stockStatus: "IN_STOCK", lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: "IN_STOCK", url: op.url },
        });
        res.singlesCreated++;
      }
    });
    console.log(`[cm-refresh] Singlar: ${res.singlesUpdated} uppdaterade, ${res.singlesCreated} nya.`);
  }

  if (opts.sealed !== false) {
    const apiProducts: ApiProduct[] = [];
    let page = 1, total = 1;
    do {
      const d = await api<{ data: ApiProduct[]; paging: { total: number } }>(`https://${HOST}/pokemon/products?page=${page}`);
      if (!d) break;
      total = d.paging.total;
      apiProducts.push(...d.data);
      await sleep(throttle);
    } while (page++ < total);

    const byEpisode = new Map<string, ApiProduct[]>();
    const apiByCmId = new Map<number, ApiProduct>();
    for (const p of apiProducts) {
      const ep = norm(p.episode?.name ?? "");
      if (ep) (byEpisode.get(ep) ?? byEpisode.set(ep, []).get(ep)!).push(p);
      if (p.cardmarket_id != null) apiByCmId.set(p.cardmarket_id, p);
    }
    const ours = await prisma.product.findMany({
      where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
      include: { set: { select: { name: true } }, offers: { select: { id: true, retailerId: true, price: true, stockStatus: true, url: true } } },
    });
    type SealedOp = { productId: string; offerId?: string; imageUrl?: string; priceOre: number; url: string; stock: "IN_STOCK" | "OUT_OF_STOCK" };
    const sealedOps: SealedOp[] = [];
    for (const p of ours) {
      const cmOffer = p.offers.find((o) => o.retailerId === cm.id);
      // 1) Exakt via cardmarket_id (idProduct i offer-URL:en) — täcker även
      //    set-lösa produkter (tins m.m. som inte kan fuzzy-matchas på set).
      let best: ApiProduct | null = null;
      let exact = false;
      const idm = cmOffer?.url?.match(/idProduct=(\d+)/);
      if (idm) { best = apiByCmId.get(parseInt(idm[1], 10)) ?? null; exact = best != null; }
      // 2) Annars fuzzy (produkter utan CM-offer): set + form + namnlikhet.
      if (!best) {
        const cands = byEpisode.get(norm(p.set?.name ?? ""));
        if (!cands?.length) continue;
        const expForm = EXPECTED_FORM[p.category] ?? null;
        const ourClean = norm(p.title);
        let bestScore = 0;
        for (const c of cands) {
          if (expForm && classifyForm(c.name) !== expForm) continue;
          if (p.category === "BOOSTER_BOX" && !/booster/i.test(c.name)) continue;
          const s = scoreSimilarity(ourClean, norm(c.name));
          if (s > bestScore) { bestScore = s; best = c; }
        }
        if (!best || bestScore < 0.55) continue;
      }
      if (best.cardmarket_id == null) continue;
      const cmp = best.prices?.cardmarket ?? {};
      // I lager = aktuell `lowest`/From → From-priset. Ur lager = ingen aktuell
      // annons → OUT_OF_STOCK + 30d-snitt. Flippar dynamiskt mellan körningar.
      const low = cmp.lowest ?? null;
      const avg = cmp["30d_average"] ?? null;
      const eur = low ?? avg;
      const priceOre = eur != null ? Math.round(eur * rates.eurToOre) : null;
      if (priceOre == null) continue; // ingen prisdata alls
      const stock = low != null ? "IN_STOCK" : "OUT_OF_STOCK";
      // butik-cross-check bara för fuzzy-träffar (exakt cmid = rätt produkt)
      if (!exact && priceOre != null) {
        const storePrices = p.offers.filter((o) => o.retailerId !== cm.id && o.price != null && o.stockStatus === "IN_STOCK").map((o) => o.price as number);
        const storeMin = storePrices.length ? Math.min(...storePrices) : null;
        if (storeMin != null && priceOre > storeMin * 2.5) continue;
      }
      // Self-heal: håll sealed-bilden i synk med CM-katalogens per-produkt-bild
      // (tcggo). Endast på EXAKT cmid-match (fuzzy kan välja fel produkt).
      const imageUrl = exact && best.image && best.image !== p.imageUrl ? best.image : undefined;
      sealedOps.push({ productId: p.id, offerId: cmOffer?.id, imageUrl, priceOre, url: cardmarketProductUrl(best.cardmarket_id), stock });
    }
    await mapPool(sealedOps, DB_CONCURRENCY, async (op) => {
      if (op.imageUrl) await prisma.product.update({ where: { id: op.productId }, data: { imageUrl: op.imageUrl } });
      // Sätt ALLTID price (även null) så ett gammalt uppblåst pris nollas när lowest försvinner.
      if (op.offerId) {
        await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: op.stock, condition: "SEALED", lastSeenAt: new Date() } });
      } else {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "EN" } },
          update: { price: op.priceOre, url: op.url, stockStatus: op.stock, lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: op.stock, url: op.url },
        });
      }
      res.sealedUpdated++;
    });
    console.log(`[cm-refresh] Sealed: ${res.sealedUpdated} uppdaterade.`);
  }

  // Uppdatera denormaliserat lägstapris (katalog-feed: sortering + gömning).
  await recomputeProductPriceCache();
  console.log(`[cm-refresh] Klart: ${res.apiCalls} API-anrop, kvot kvar ${res.remaining}.`);
  return res;
}
