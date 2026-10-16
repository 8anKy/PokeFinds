/**
 * AVSLUTADE TRADERA-ANNONSER SKA INTE STÅ KVAR SOM "I LAGER" (2026-10-14).
 *
 * Ägaren hittade N · 30th Celebration: Classic Collection med "Lägsta pris · Tradera 60 kr,
 * I lager" — annonsen var avslutad. Svepets utgångsfas (Fas 3) rör bara produkter som
 * NAMN-SÖKTES samma natt, och rotationen varvar ~56 000 produkter: en död annons kunde stå
 * kvar i 1–2 veckor. MÄTT samma dag: 10 272 av 25 490 Tradera-priser var inte sedda på
 * 7–13 dygn. ⛔ MEN ÅLDER ÄR INGEN DOM — ett stickprov via GetItem gav 0/50 döda bland
 * 0–2 dygn, 5/50 bland 3–6 och 10/50 bland 7–13 (butiksannonser lever länge). Att gallra
 * på ålder hade dolt ~80 % levande priser. Därför två BEVISVÄGAR:
 *
 *  1. `retireEndedTraderaListings` — sålt-svepet hämtar ändå VARJE avslutad Pokémon-annons
 *     varje natt (~11 500 st). Står en av dem som vår offer eller skena-rad ⇒ bort.
 *  2. `verifyStaleTraderaOffers` — de som inte setts på `minAgeDays` frågas direkt
 *     (PublicService.GetItem), äldst först, inom en budget. Levande ⇒ `lastSeenAt` bumpas
 *     (vi HAR sett den), avslutad ⇒ samma pensionering som (1).
 *
 * Pensioneringen: skena-raden raderas, nästa vettiga annons lyfts fram som offer
 * (`findReplacementListing`), annars blir offern Traderas sök-URL utan pris — samma
 * nollställning som Fas 3. ⛔ Prisobservationerna står kvar: annonsen VAR verklig när den
 * sågs, och grafen är historik.
 */
import { StockStatus } from "@prisma/client";
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { findReplacementListing, listingItemIdFromUrl, writeMarketplaceOffer } from "../services/marketplace-offers";
import { recomputeProductPriceCache } from "../services/products";
import { traderaResetSearchUrl } from "./tradera-sweep";

const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";

export interface RetireResult {
  offersRetired: number;
  replaced: number;
  railsDeleted: number;
}

/** Pensionera allt vi visar för annonserna i `endedItemIds`. Ren DB-skrivning. */
export async function retireEndedTraderaListings(
  endedItemIds: Iterable<string>,
  opts: { recompute?: boolean } = {}
): Promise<RetireResult> {
  const ended = new Set(endedItemIds);
  const result: RetireResult = { offersRetired: 0, replaced: 0, railsDeleted: 0 };
  if (ended.size === 0) return result;

  const ids = [...ended];
  for (let i = 0; i < ids.length; i += 1000) {
    result.railsDeleted += (
      await prisma.traderaListing.deleteMany({ where: { itemId: { in: ids.slice(i, i + 1000) } } })
    ).count;
  }

  const tradera = await prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } });
  if (!tradera) return result;
  const offers = (
    await prisma.offer.findMany({
      where: { retailerId: tradera.id, price: { not: null } },
      select: {
        id: true,
        url: true,
        productId: true,
        product: {
          select: {
            title: true,
            category: true,
            card: { select: { name: true, set: { select: { name: true } } } },
          },
        },
      },
    })
  ).filter((o) => {
    const itemId = listingItemIdFromUrl(o.url);
    return itemId != null && ended.has(itemId);
  });

  await mapPool(offers, 8, async (o) => {
    const replacement = await findReplacementListing(o.productId, listingItemIdFromUrl(o.url));
    if (replacement && !ended.has(replacement.itemId)) {
      await writeMarketplaceOffer(o.productId, tradera.id, o.product.category, replacement);
      result.replaced++;
    } else {
      await prisma.offer.update({
        where: { id: o.id },
        data: { price: null, stockStatus: StockStatus.UNKNOWN, url: traderaResetSearchUrl(o.product) },
      });
    }
    result.offersRetired++;
  });

  if (result.offersRetired > 0 && opts.recompute !== false) await recomputeProductPriceCache();
  return result;
}

/** GetItem-domen: avslutad, borttagen (fault) eller levande med nuvarande Köp nu-pris. */
export function getItemLiveness(xml: string, now = Date.now()): { ended: boolean; buyNowOre: number | null } {
  if (/<(soap:|s:)?Fault>/.test(xml) || !/<Id>\d+<\/Id>/.test(xml)) return { ended: true, buyNowOre: null };
  if (/<Ended>true<\/Ended>/.test(xml)) return { ended: true, buyNowOre: null };
  const end = xml.match(/<EndDate>([^<]+)<\/EndDate>/)?.[1];
  if (end && new Date(end).getTime() < now) return { ended: true, buyNowOre: null };
  // En AUKTION är inget fastpris — Köp nu försvinner vid första budet (se parseItemsFromXml). Gamla
  // auktions-offers pensioneras som avslutade.
  if (/<ItemType>Auction/i.test(xml)) return { ended: true, buyNowOre: null };
  const bin = xml.match(/<BuyItNowPrice>([\d.,]+)<\/BuyItNowPrice>/)?.[1];
  const kr = bin ? parseFloat(bin.replace(",", ".")) : NaN;
  return { ended: false, buyNowOre: Number.isFinite(kr) && kr > 0 ? Math.round(kr * 100) : null };
}

async function fetchGetItem(appId: string, appKey: string, itemId: string): Promise<string> {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com"><soap:Header><trad:AuthenticationHeader><trad:AppId>${appId}</trad:AppId><trad:AppKey>${appKey}</trad:AppKey></trad:AuthenticationHeader><trad:ConfigurationHeader><trad:Sandbox>0</trad:Sandbox><trad:MaxResultAge>0</trad:MaxResultAge></trad:ConfigurationHeader></soap:Header><soap:Body><trad:GetItem><trad:itemId>${itemId}</trad:itemId></trad:GetItem></soap:Body></soap:Envelope>`;
  const res = await fetch(`${PUBLIC_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/GetItem"` },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  // 429/5xx = "vet inte" — kasta, så raden INTE döms som avslutad.
  if (res.status === 429 || res.status >= 500 || /AboveCallLimit/.test(text)) {
    throw new Error(`HTTP ${res.status}${/AboveCallLimit/.test(text) ? " AboveCallLimit" : ""}`);
  }
  return text;
}

export interface VerifyStaleResult extends RetireResult {
  checked: number;
  alive: number;
  priceUpdated: number;
  quotaHit: boolean;
}

/**
 * Fråga Tradera om offers som inte setts på `minAgeDays`, äldst först, högst `max` anrop.
 * GetItem-kvoten (10 000/dygn) delas med sålt-svepet, som använder ~3 300/natt (mätt 10-14).
 */
export async function verifyStaleTraderaOffers(opts: {
  max?: number;
  minAgeDays?: number;
  dryRun?: boolean;
  log?: (m: string) => void;
} = {}): Promise<VerifyStaleResult> {
  // 5 000 / 2 d sedan 2026-10-16 (var 4 000 / 3 d): kön av osedda ≥ 3 d var ~6 500 och ett GetItem-stickprov
  // gav 8 % döda priser. Sålt-svepet använder ~3 300 av GetItems 10 000/dygn (tak 6 000; slår det i kvoten
  // skriver det det som hann). Relevance-reserven i sålt-svepet ser sämre de LÅNGLIVADE annonserna som
  // avslutats nyss — de fångas här.
  const max = opts.max ?? parseInt(process.env.TRADERA_VERIFY_STALE_MAX ?? "5000", 10);
  const minAgeDays = opts.minAgeDays ?? 2;
  const log = opts.log ?? ((m: string) => console.log(m));
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  const out: VerifyStaleResult = { checked: 0, alive: 0, priceUpdated: 0, quotaHit: false, offersRetired: 0, replaced: 0, railsDeleted: 0 };
  if (!appId || !appKey || max <= 0) return out;

  const tradera = await prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } });
  if (!tradera) return out;
  const stale = await prisma.offer.findMany({
    where: {
      retailerId: tradera.id,
      price: { not: null },
      lastSeenAt: { lt: new Date(Date.now() - minAgeDays * 86_400_000) },
    },
    orderBy: { lastSeenAt: "asc" },
    take: max,
    select: { id: true, url: true, price: true },
  });

  const ended: string[] = [];
  const aliveIds: string[] = [];
  await mapPool(stale, 4, async (o) => {
    if (out.quotaHit) return;
    const itemId = listingItemIdFromUrl(o.url);
    if (!itemId) return;
    let verdict;
    try {
      verdict = getItemLiveness(await fetchGetItem(appId, appKey, itemId));
    } catch (err) {
      if (String(err).includes("429") || String(err).includes("AboveCallLimit")) out.quotaHit = true;
      return;
    }
    out.checked++;
    if (verdict.ended) {
      ended.push(itemId);
      return;
    }
    out.alive++;
    aliveIds.push(o.id);
    if (!opts.dryRun && verdict.buyNowOre != null && verdict.buyNowOre !== o.price) {
      await prisma.offer.update({ where: { id: o.id }, data: { price: verdict.buyNowOre } });
      out.priceUpdated++;
    }
  });

  if (!opts.dryRun) {
    // Levande = sedd nu. Utan bumpen frågas samma levande annonser om varje natt.
    for (let i = 0; i < aliveIds.length; i += 1000) {
      await prisma.offer.updateMany({
        where: { id: { in: aliveIds.slice(i, i + 1000) } },
        data: { lastSeenAt: new Date(), stockStatus: StockStatus.IN_STOCK },
      });
    }
    Object.assign(out, await retireEndedTraderaListings(ended, { recompute: false }));
    if (out.offersRetired > 0 || out.priceUpdated > 0) await recomputeProductPriceCache();
  }
  log(
    `[tradera-stale] ${out.checked}/${stale.length} kollade (≥ ${minAgeDays} d osedda): ${out.alive} levande, ` +
      `${ended.length} avslutade → ${out.offersRetired} offers pensionerade (${out.replaced} ersatta), ` +
      `${out.railsDeleted} skena-rader bort, ${out.priceUpdated} nya priser${out.quotaHit ? " [GetItem-kvot slut]" : ""}` +
      `${opts.dryRun ? " (torrkörning)" : ""}`
  );
  return out;
}
