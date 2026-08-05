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
import { getRatesOre, priceOreFromEur } from "../lib/exchange-rate";
import {
  cardmarketProductUrl,
  isEnglishCardmarketUrl,
  withFirstEd,
  withNearMint,
  type FirstEdFilter,
} from "../lib/marketplace-urls";
import {
  PRINT_FIRST_EDITION,
  PRINT_UNLIMITED,
  isPrintVariantLabel,
  printLabelFromVersion,
} from "../lib/print-variant";
import { recomputeProductPriceCache } from "../services/products";
import { fetchCmGuide, fetchCmSingleNames, guideNameMatches, guideRowIsSingle, singlesHeadlineEur } from "./cardmarket-refresh";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API_CONCURRENCY = 4;
const DB_CONCURRENCY = 8;

interface CmCard {
  cardmarket_id: number | null;
  name?: string | null;
  // TRYCKNINGEN raden gäller. `?tcgid=` svarar med EN RAD PER TRYCKNING i WOTC-
  // seten, och det är 1st Edition-raden som bär tcgid:t — därför räcker det inte
  // att ta data[0], se pickRowForProduct.
  version?: string | null;
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
  // OBLIGATORISKT: utan tryckningen kan rätt feed-rad inte väljas, och ett fält
  // som glöms i ett select gör vakten tyst verkningslös (samma fälla som
  // matchListingToProduct 2026-07-28).
  variantLabel: string | null;
  card: { tcgExternalId: string | null } | null;
  offers: { id: string; url: string }[];
};

/**
 * Vilken av `?tcgid=`-svarets rader gäller PRECIS den här produkten?
 *
 * ⛔ `data[0]` DUGER INTE, och det här jobbet kan INTE välja tryckning som den
 * dagliga körningen gör. MÄTT 2026-07-28: `?tcgid=base1-1` svarar med EXAKT EN
 * rad — "1st Edition Shadowless" — och `?tcgid=neo1-1` med en "1st Edition"-rad.
 * I WOTC-seten hänger tcgid:t på 1st Edition-tryckningen, så uppslaget ser bara
 * DEN. Dagliga körningen läser hela episoden och kan jämföra tryckningarna;
 * härifrån finns inget att jämföra med.
 *
 * Därför är regeln konservativ: raden måste VARA produktens tryckning.
 *  - Tryckningsprodukt → exakt sin egen etikett (en Unlimited-produkt tar bara en
 *    Unlimited-rad, aldrig 1st Edition-raden som råkar bära tcgid:t).
 *  - Vanlig produkt (katalogens ordinarie kort) → omärkt rad eller "Unlimited".
 *    En 1st Edition- eller Shadowless-rad är ett ANNAT kort och publiceras inte;
 *    då står dagens pris från dagliga körningen kvar, vilket är hela poängen.
 *    Utan det skrev kvällskörningen 1st Edition-priset på det ordinarie kortet
 *    några timmar efter att dagliga körningen valt rätt tryckning.
 *
 * `null` = ingen rad hör hit → produkten hoppas över (ingen skrivning).
 */
export function pickRowForProduct(
  rows: CmCard[],
  variantLabel: string | null,
  hasFrom: (row: CmCard) => boolean,
): CmCard | null {
  const productLabel = isPrintVariantLabel(variantLabel) ? variantLabel : null;
  const mine = rows.filter((r) => {
    const rowLabel = printLabelFromVersion(r.version);
    if (productLabel) return rowLabel === productLabel;
    // Ordinarie katalogkort: omärkt (moderna set) eller uttryckligen Unlimited.
    return rowLabel === null || rowLabel === PRINT_UNLIMITED;
  });
  if (mine.length === 0) return null;
  // Ett äkta From går före en uppskattning; `undefined` är inte bevis för att
  // From saknas, så vi letar bevis för att det FINNS.
  const real = mine.find(hasFrom);
  if (real) return real;
  // BARA UNLIMITED/ordinarie får uppskattas: Shadowless och 1st Edition delar
  // CM-produkt, så en uppskattning hade gett båda exakt samma värde.
  return productLabel === null || productLabel === PRINT_UNLIMITED ? mine[0] : null;
}

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
    variantLabel: true,
    card: { select: { tcgExternalId: true } },
    offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 },
  } as const;
  const baseWhere = {
    category: "SINGLE_CARD" as const,
    card: { tcgExternalId: { not: null } },
    offers: { some: { retailerId: cm.id } },
    // Tryckningar ÄR med: pickRowForProduct väljer raden för precis produktens
    // tryckning, precis som dagliga körningen. (De var undantagna en kort stund
    // 2026-07-28, innan raden valdes rätt — då hade jobbet skrivit 1st
    // Edition-priset på Unlimited och Shadowless samma kväll.)
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

  // SAMMA prisregel som dagliga cardmarket-refresh (GOLVET RAKT AV, ägarbeslut
  // 2026-07-24): From publiceras exakt som CM listar den; trend/30d BARA när From
  // saknas, och då som OUT_OF_STOCK-uppskattning. Ingen per-kort-dagklämma (den
  // kan inte skilja ett äkta ask-hopp från glitch utan att bli en spärrhake) och
  // ingen haveribrytare här: jobbet rör ≤400 offers, skriver ingen historik, och
  // nästa dagliga körning omvärderar allt. Guiden är en gratis nedladdning (0 kvot).
  // Identitetsvakten måste finnas HÄR också: annars skulle det här jobbet återinföra
  // en felmappad guide-rads pris några timmar efter att dagliga körningen rensat den.
  const [guide, cmNames] = await Promise.all([fetchCmGuide(), fetchCmSingleNames()]);
  const ops: { offerId?: string; productId: string; priceOre: number; from: boolean; url: string }[] = [];
  await mapPool(hot, API_CONCURRENCY, async (p) => {
    const ext = p.card?.tcgExternalId;
    if (!ext) return;
    const d = await api<{ data: CmCard[] }>(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(ext)}`);
    await sleep(throttle * API_CONCURRENCY);
    const rows = d?.data ?? [];
    const offer = p.offers[0];
    // GUIDE-RADEN FÖR EN TRYCKNING KOMMER UR OFFERNS LÄNK, inte ur feedens
    // cardmarket_id: det är samma id för Shadowless och 1st Edition och pekar
    // mätbart fel på var fjärde Base-rad. Länken satte vi själva ur CM:s katalog.
    const linkedCmId = isPrintVariantLabel(p.variantLabel)
      ? Number(offer?.url?.match(/idProduct=(\d+)/)?.[1] ?? NaN)
      : NaN;
    /** Har raden ett BEVISAT äkta From? `undefined` är inte bevis för motsatsen. */
    const rowHasFrom = (r: CmCard) => typeof r.prices?.cardmarket?.lowest_near_mint === "number";
    const card = pickRowForProduct(rows, p.variantLabel, rowHasFrom);
    if (!card) return;
    const cmp = card.prices?.cardmarket ?? {};
    // Båda identitetsfrågorna, samma som dagliga körningen: är raden en SINGEL, och
    // är den i så fall VÅRT kort? Utan guideRowIsSingle hade det här jobbet återinfört
    // en sealed-produkts golvpris (Pidgey · Flashfire: 3 262 kr) några timmar efter
    // att dagliga körningen rensat det.
    const guideId = Number.isFinite(linkedCmId) ? linkedCmId : card.cardmarket_id;
    const g =
      guideId != null &&
      guideRowIsSingle(guideId, cmNames) &&
      guideNameMatches(cmNames.get(guideId), card.name)
        ? guide.get(guideId)
        : undefined;
    const priced = singlesHeadlineEur({ from: cmp.lowest_near_mint, avg30: cmp["30d_average"] }, g);
    if (priced == null) return;
    // BARA UNLIMITED FÅR UPPSKATTAS — Shadowless och 1st Edition delar CM-produkt,
    // så en uppskattning hade gett båda samma värde. Samma regel som dagliga körningen.
    if (isPrintVariantLabel(p.variantLabel) && p.variantLabel !== PRINT_UNLIMITED && !priced.from) return;
    const wantFirstEd: FirstEdFilter = p.variantLabel === PRINT_FIRST_EDITION ? "only" : "exclude";
    const url =
      offer?.url && isEnglishCardmarketUrl(offer.url) ? withFirstEd(withNearMint(offer.url), wantFirstEd)
        // Tryckningsprodukter länkas ALDRIG av feeden: dess cardmarket_id pekar
        // mätbart fel (38 av 147 Base-rader). Saknas vår egen länk får produkten
        // hellre ingen uppdatering.
        : isPrintVariantLabel(p.variantLabel) ? offer?.url ?? null
          : card.cardmarket_id != null ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true, firstEd: "exclude" })
            : offer?.url ?? null;
    if (!url) return;
    const priceOre = priceOreFromEur(priced.eur, rates);
    if (priceOre == null) return; // 0 kr är inget pris — se priceOreFromEur
    ops.push({
      offerId: offer?.id, productId: p.id,
      priceOre,
      from: priced.from,
      url,
    });
  });

  await mapPool(ops, DB_CONCURRENCY, async (op) => {
    const stock = op.from ? "IN_STOCK" : "OUT_OF_STOCK"; // uppskattning ≠ köpbar annons
    if (op.offerId) {
      await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: stock, condition: "NEAR_MINT", lastSeenAt: new Date() } });
    } else {
      await prisma.offer.upsert({
        where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
        update: { price: op.priceOre, url: op.url, stockStatus: stock, lastSeenAt: new Date() },
        create: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: stock, url: op.url },
      });
    }
    res.updated++;
  });

  if (res.updated > 0) await recomputeProductPriceCache();
  console.log(`[hot-refresh] ${res.updated} kort uppdaterade, ${res.apiCalls} anrop (kvot kvar ${res.remaining}).`);
  return res;
}
