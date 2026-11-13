/**
 * ONE PIECE (ENGELSKA) SINGLAR UR LEVERANTÖREN (2026-11-10, ägarbeslut: One Piece steg 2).
 *
 * Källa: `/one-piece/cards` (~350 sidor à 20 ⇒ ~350 anrop/natt av 15 000). Samma princip som
 * sealed-importen: identiteten är Cardmarkets `idProduct` — kort utan `cardmarket_id` skapas inte.
 *
 *  1. Ett `Card` per leverantörskort (`tcgExternalId "tcggo-op-card:<id>"`, numret = kortets
 *     tryckta kod "OP08-007"). Alternativa konster (V.2, V.3 …) delar nummer men har egen konst och
 *     eget `idProduct` ⇒ eget kort, märkt med sin sällsynthet i titeln.
 *  2. En `SINGLE_CARD`-produkt (`game: ONE_PIECE`) + en Cardmarket-offer (NEAR_MINT, EN).
 *  3. Priset = leverantörens `lowest_near_mint` (CM:s engelska NM-From — kontrollerat mot CM:s
 *     filtrerade sidor 2026-11-10: Chopper OP08-007 V.2 18,00 €, Kaido & Linlin OP08-119 3,80 €).
 *     ⛔ Saknas From, eller är den ett UTROP (> 10× snittet OCH > 25 € över det — samma regel som
 *     Pokémon), blir priset snittet och offern OUT_OF_STOCK ⇒ "Uppskattat" i UI:t.
 *
 * ⛔ Skannern, eBay/graderat, TCGdex-fakta, konstavtryck och bildlagningen är Pokémon och hoppar
 * över One Piece (`set.game`/`game`-filter i respektive jobb + lib/scanner-exclusion).
 */
import { prisma } from "@/lib/db";
import { getRatesOre, priceOreFromEur } from "@/lib/exchange-rate";
import { cardmarketOnePieceProductUrl, withNearMint } from "@/lib/marketplace-urls";
import { normalizeTitle, slugify, utcToday } from "@/lib/utils";
import { decodeEntities } from "@/lib/rss";
import { mapPool } from "@/lib/concurrency";

const THROTTLE_MS = 200;
const SET_EXTERNAL_PREFIX = "tcggo-op:";
export const OP_CARD_EXTERNAL_PREFIX = "tcggo-op-card:";
/** Utropsvakten — samma tal som Pokémon-singlarna (cm-pricing.md punkt 1, ändrad 2026-10-16). */
const ASK_MULT = 10;
const ASK_GAP_EUR = 25;

export interface OpApiCard {
  id: number;
  name: string;
  card_number?: string | number | null;
  card_code_number?: string | number | null;
  rarity?: string | null;
  version?: string | number | null;
  lang?: string | null;
  cardmarket_id: number | null;
  image?: string | null;
  artist?: { name?: string | null } | null;
  episode?: { id?: number | null } | null;
  prices?: {
    cardmarket?: {
      lowest_near_mint?: number | null;
      available_items?: number | null;
      "30d_average"?: number | null;
      "7d_average"?: number | null;
    } | null;
  } | null;
}

/**
 * Ren dom: leverantörens priser → { eur, live }. `live` = en riktig engelsk NM-annons (IN_STOCK);
 * annars en uppskattning ur snitten. null = inget pris alls.
 */
export function onePieceSinglePrice(
  cm: NonNullable<OpApiCard["prices"]>["cardmarket"] | null | undefined
): { eur: number; live: boolean } | null {
  const nm = typeof cm?.lowest_near_mint === "number" && cm.lowest_near_mint > 0 ? cm.lowest_near_mint : null;
  const avgs = [cm?.["7d_average"], cm?.["30d_average"]].filter((v): v is number => typeof v === "number" && v > 0);
  const avgMax = avgs.length ? Math.max(...avgs) : null;
  const ask = nm != null && avgMax != null && nm > avgMax * ASK_MULT && nm - avgMax > ASK_GAP_EUR;
  if (nm != null && !ask && (cm?.available_items ?? 0) > 0) return { eur: nm, live: true };
  // Uppskattning: 7-dagarssnittet först (färskast), annars 30 dagar.
  const est = [cm?.["7d_average"], cm?.["30d_average"]].find((v): v is number => typeof v === "number" && v > 0);
  return est != null ? { eur: est, live: false } : null;
}

/** "OP08-007" ur `card_number`, annars sista ordet i "OP-08 OP08-007". */
export function onePieceCardNumber(c: Pick<OpApiCard, "card_number" | "card_code_number">): string | null {
  // ⛔ Leverantören skickar ibland numret som TAL (mätt 2026-11-10) — alltid via String().
  const n = String(c.card_number ?? "").trim() || String(c.card_code_number ?? "").trim().split(/\s+/).pop() || "";
  return n || null;
}

/** Är det en alternativ konst (V.2, V.3 …)? V.1 och ingen version = grundkortet. */
export function isOnePieceAltVersion(version: string | number | null | undefined): boolean {
  const m = /^v\.?\s*(\d+)$/i.exec(String(version ?? "").trim());
  return !!m && parseInt(m[1], 10) > 1;
}

/**
 * Produkttiteln: "Tony Tony.Chopper OP08-007", alternativ konst "Tony Tony.Chopper OP08-007
 * (Alternate Art)". Flera alternativ med samma sällsynthet ⇒ versionen läggs till ("… V.3").
 */
export function onePieceSingleTitle(name: string, number: string, rarity: string | null, version: string | null, dupRarity: boolean): string {
  if (!isOnePieceAltVersion(version)) return `${name} ${number}`;
  const label = [rarity?.trim() || "Alternate Art", dupRarity ? version?.trim() : null].filter(Boolean).join(" ");
  return `${name} ${number} (${label})`;
}

export interface OpSinglesImportResult {
  apiCalls: number;
  listed: number;
  cardsCreated: number;
  productsCreated: number;
  priced: number;
  estimated: number;
  historyPoints: number;
  skippedNoId: number;
  skippedNoSet: number;
  samples: string[];
}

async function fetchAllCards(host: string, key: string, res: OpSinglesImportResult): Promise<OpApiCard[]> {
  const out: OpApiCard[] = [];
  let page = 1;
  let total = 1;
  do {
    const r = await fetch(`https://${host}/one-piece/cards?page=${page}`, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
    res.apiCalls++;
    // ⛔ Fail loud: en tappad sida = tyst uteblivna kort (och uteblivna prisuppdateringar).
    if (!r.ok) throw new Error(`[op-singles] /one-piece/cards?page=${page} HTTP ${r.status}`);
    const d = (await r.json()) as { data?: OpApiCard[]; paging?: { total?: number } };
    total = d.paging?.total ?? 1;
    out.push(...(d.data ?? []));
    page++;
    await new Promise((ok) => setTimeout(ok, THROTTLE_MS));
  } while (page <= total);
  return out;
}

export async function runOnePieceSinglesImport(
  opts: { apply?: boolean; log?: (s: string) => void } = {}
): Promise<OpSinglesImportResult> {
  const apply = opts.apply ?? false;
  const log = opts.log ?? ((s: string) => console.log(s));
  const res: OpSinglesImportResult = {
    apiCalls: 0, listed: 0, cardsCreated: 0, productsCreated: 0, priced: 0, estimated: 0, historyPoints: 0,
    skippedNoId: 0, skippedNoSet: 0, samples: [],
  };
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";
  if (!KEY) return res;
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) return res;
  const rates = await getRatesOre();

  // Seten finns redan (sealed-importen skapar dem per episod, före det här steget).
  const sets = await prisma.cardSet.findMany({
    where: { game: "ONE_PIECE", externalId: { startsWith: SET_EXTERNAL_PREFIX } },
    select: { id: true, externalId: true },
  });
  const setByEpisode = new Map(sets.map((s) => [parseInt(s.externalId!.slice(SET_EXTERNAL_PREFIX.length), 10), s.id]));

  const all = (await fetchAllCards(HOST, KEY, res)).filter((c) => (c.lang ?? "en") === "en");
  res.listed = all.length;

  // Befintligt: kort på externt id, produkter + CM-offers på kort-id.
  const existingCards = await prisma.card.findMany({
    where: { tcgExternalId: { startsWith: OP_CARD_EXTERNAL_PREFIX } },
    select: {
      id: true,
      tcgExternalId: true,
      cardmarketId: true,
      imageUrl: true,
      products: {
        where: { category: "SINGLE_CARD" },
        select: { id: true, offers: { where: { retailerId: cm.id }, select: { id: true, price: true, stockStatus: true }, take: 1 } },
        take: 1,
      },
    },
  });
  const cardByExt = new Map(existingCards.map((c) => [c.tcgExternalId!, c]));

  // Titlarna behöver veta om två alternativ i samma set delar nummer + sällsynthet.
  const rarityCount = new Map<string, number>();
  for (const c of all) {
    if (!isOnePieceAltVersion(c.version)) continue;
    const k = `${c.episode?.id}\t${onePieceCardNumber(c)}\t${(c.rarity ?? "").toLowerCase()}`;
    rarityCount.set(k, (rarityCount.get(k) ?? 0) + 1);
  }

  const points: { productId: string; priceOre: number }[] = [];
  const usedSlugs = new Set<string>();

  await mapPool(all, 6, async (c) => {
    const idProduct = c.cardmarket_id;
    if (idProduct == null) { res.skippedNoId++; return; }
    const setId = c.episode?.id != null ? setByEpisode.get(c.episode.id) : undefined;
    if (!setId) { res.skippedNoSet++; return; }
    const number = onePieceCardNumber(c);
    if (!number) { res.skippedNoId++; return; }
    const name = decodeEntities(String(c.name ?? "")).trim();
    if (!name) return;
    const rarity = decodeEntities(String(c.rarity ?? "")).trim() || null;
    const version = c.version != null ? String(c.version).trim() || null : null;
    const dup = (rarityCount.get(`${c.episode?.id}\t${number}\t${(c.rarity ?? "").toLowerCase()}`) ?? 0) > 1;
    const title = onePieceSingleTitle(name, number, rarity, version, dup);
    const price = onePieceSinglePrice(c.prices?.cardmarket);
    const priceOre = price ? priceOreFromEur(price.eur, rates) : null;
    const stockStatus = priceOre != null && price?.live ? "IN_STOCK" : "OUT_OF_STOCK";
    if (priceOre != null) {
      if (price?.live) res.priced++;
      else res.estimated++;
    }
    const ext = `${OP_CARD_EXTERNAL_PREFIX}${c.id}`;
    const image = c.image ?? null;
    const url = withNearMint(cardmarketOnePieceProductUrl(idProduct));

    const existing = cardByExt.get(ext);
    if (existing) {
      const product = existing.products[0];
      if (!product) return; // kortet utan produkt läker inte här — skapas bara tillsammans
      // ⛔ Kortet äger inte id:t (ett annat kort fick det) ⇒ ingen offer, aldrig det andra kortets pris.
      if (existing.cardmarketId !== idProduct) return;
      if (priceOre != null) points.push({ productId: product.id, priceOre });
      if (!apply) return;
      if (image && existing.imageUrl !== image) {
        await prisma.card.update({ where: { id: existing.id }, data: { imageUrl: image } });
      }
      const offer = product.offers[0];
      if (offer) {
        // ⛔ Utan pris står det gamla kvar — "–" är bara för en produkt som aldrig haft ett.
        if (priceOre != null && (offer.price !== priceOre || offer.stockStatus !== stockStatus)) {
          await prisma.offer.update({ where: { id: offer.id }, data: { price: priceOre, stockStatus, lastSeenAt: new Date() } });
        }
      } else {
        await prisma.offer.create({
          data: { productId: product.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: priceOre, currency: "SEK", stockStatus, url },
        });
      }
      return;
    }

    res.cardsCreated++;
    res.productsCreated++;
    if (res.samples.length < 12) res.samples.push(`${title} #${idProduct}${priceOre != null ? ` ${(priceOre / 100).toFixed(2)} kr${price?.live ? "" : " (uppsk.)"}` : " –"}`);
    if (!apply) return;

    let borrowedId = false;
    const card = await prisma.card
      .create({
        data: {
          setId, name, number, rarity: rarity ?? "", imageUrl: image, language: "EN",
          tcgExternalId: ext, tcggoId: c.id, cardmarketId: idProduct, artist: c.artist?.name ?? null,
        },
        select: { id: true },
      })
      .catch(async () => {
        // cardmarketId @unique: ett annat kort bär redan id:t (leverantörsfel, 11 st 2026-11-10) ⇒
        // skapa utan. ⛔ Då får kortet INGEN offer: länken och priset tillhör det andra kortet.
        borrowedId = true;
        console.warn(`[op-singles] ${title}: Cardmarket-id ${idProduct} tillhör redan ett annat kort — skapas utan pris`);
        return prisma.card.create({
          data: { setId, name, number, rarity: rarity ?? "", imageUrl: image, language: "EN", tcgExternalId: ext, tcggoId: c.id, artist: c.artist?.name ?? null },
          select: { id: true },
        });
      });

    let slug = slugify(`one piece ${name} ${number}${isOnePieceAltVersion(version) ? ` ${version}` : ""}`) || `one-piece-card-${c.id}`;
    // Reservera synkront (mapPool kör parallellt), sedan mot databasen.
    if (usedSlugs.has(slug)) slug = `${slug}-${c.id}`;
    usedSlugs.add(slug);
    if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${c.id}`;
    const product = await prisma.product.create({
      data: {
        title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD", language: "EN", game: "ONE_PIECE",
        cardId: card.id, setId, imageUrl: image,
      },
      select: { id: true },
    });
    if (borrowedId) return;
    if (priceOre != null) points.push({ productId: product.id, priceOre });
    await prisma.offer.create({
      data: { productId: product.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: priceOre, currency: "SEK", stockStatus, url },
    });
  });

  res.historyPoints = points.length;
  if (apply && points.length > 0) {
    const { writeCardmarketHistoryPoints } = await import("@/jobs/cardmarket-refresh");
    await writeCardmarketHistoryPoints(points, utcToday());
  }

  log(
    `[op-singles] ${res.listed} kort hos leverantören → ${res.cardsCreated} ${apply ? "skapade" : "SKULLE skapas"}, ` +
      `${res.priced} med NM-pris, ${res.estimated} uppskattade, ${res.skippedNoId} utan CM-id, ${res.skippedNoSet} utan set. ` +
      `${res.apiCalls} API-anrop.`
  );
  return res;
}
