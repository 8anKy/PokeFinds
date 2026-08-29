/**
 * JAPANSKA SINGLAR — import + daglig prisuppdatering (2026-08-29, ägarbeslut).
 *
 * Källa: RapidAPI:s `/pokemon-jp/cards` (samma leverantör och kvot som de engelska
 * singlarna). ⛔ ANVÄND DEN GLOBALA LISTAN, INTE `/pokemon-jp/episodes/{id}/cards`:
 * per-set-endpointen är tom för 62 av 71 set (mätt 2026-08-29: 1 097 kort mot
 * 5 553 i den globala listan). Listan är 278 sidor à 20 kort ⇒ ~280 anrop/dygn.
 *
 * VAD LEVERANTÖREN GER (mätt över alla 5 553): `name_en` 100 %, bild 100 %,
 * nummer 100 %, rarity 99,8 %, JP NM-"From" (`lowest_near_mint_JP`) 72 %,
 * `cardmarket_id` **0 %**. 24 av 71 set (nästan hela 2021–2022: VSTAR Universe,
 * VMAX Climax, Eevee Heroes …) saknar kort helt hos leverantören — de dyker upp
 * av sig själva den dag listan växer, jobbet är idempotent.
 *
 * IDENTITET: `Card.tcgExternalId = "tcggo-jp:<id>"` (leverantörens kort-id — JP
 * finns inte hos pokemontcg.io, och prefixet gör provenansen entydig). Nya set får
 * `CardSet.externalId = "tcggo-jp:<episode id>"`, befintliga JP-set (skapade ur CM:s
 * expansioner) matchas på SETKOD (`codeFromJpSetName`) och i andra hand på namn —
 * alltid med `language: "JP"`, se jp-sets.md.
 *
 * NAMN: engelska namnet + " (JP)" (ägarbeslut) — både på kortet och i produkttiteln.
 * Skannern får därmed EN-kortet först vid lika läsning (exakt namn-bonus faller
 * bara ut för "Tropius", inte "Tropius (JP)") och JP-kortet som val i listan.
 *
 * LÄNK: ingen produktsida finns → offern bär `cardmarketJpSearchUrl` (CM-sök,
 * language=7). Det är det enda sök-URL som får bära ett pris — se undantaget i
 * `isDirectOfferUrl`. Skulle leverantören börja leverera `cardmarket_id` uppgraderas
 * länken automatiskt till en riktig produktsida (`cardmarketJapaneseProductUrl`).
 *
 * ⛔ Priser via `priceOreFromEur` — 0 kr är inget pris. Stock: From finns ⇒ IN_STOCK,
 * bara 30d-snitt ⇒ uppskattning (OUT_OF_STOCK, samma modell som EN), inget ⇒
 * länk-offer utan pris. Daglig historik skrivs FRAMÅT (PriceObservation + snapshot).
 */
import { prisma } from "@/lib/db";
import { mapPool } from "@/lib/concurrency";
import { getRatesOre, priceOreFromEur } from "@/lib/exchange-rate";
import { normalizeTitle, slugify, utcToday } from "@/lib/utils";
import {
  cardmarketJapaneseProductUrl,
  cardmarketJpSearchUrl,
  isCardmarketJpSearchUrl,
} from "@/lib/marketplace-urls";
import { codeFromJpSetName, jpSetDisplayName } from "@/lib/jp-set-name";
import { upsertTodaySnapshots } from "@/jobs/cardmarket-refresh";
// ⛔ INGEN `fs`/`path` HÄR: modulen nås från cardmarket-refresh, som instrumentation.ts
// importerar — och den kompileras även för Edge-runtimen, där Node-moduler inte
// finns. Bygget föll på exakt det 2026-08-29 (deploy 389d8ca).

const DB_CONCURRENCY = 8;
const THROTTLE_MS = 220;
export const JP_EXTERNAL_PREFIX = "tcggo-jp:";

interface JpApiCard {
  id: number;
  name: string;
  name_en: string | null;
  card_number: number | string | null;
  card_code_number: string | null;
  rarity: string | null;
  cardmarket_id: number | null;
  image: string | null;
  artist: { name?: string | null } | null;
  prices: { cardmarket?: { lowest_near_mint_JP?: number | null; "30d_average"?: number | null } | null } | null;
  episode: {
    id: number;
    name: string;
    code: string | null;
    released_at: string | null;
    logo: string | null;
    cards_total: number | null;
    cards_printed_total: number | null;
    series: { name?: string | null } | null;
  } | null;
}

export interface JpSinglesResult {
  apiCalls: number;
  remaining: number;
  cards: number;
  setsCreated: number;
  cardsCreated: number;
  productsCreated: number;
  offersWritten: number;
  historyPoints: number;
  skippedNoEpisode: number;
  skippedNoName: number;
  /** Leverantörens cardmarket_id ≠ vårt verifierade — loggas, skrivs aldrig. */
  cmIdDisagreements: number;
}

/** "SECRET RARE" / "rare" / "Double Rare" → "Secret Rare" / "Rare" / "Double Rare". */
export function normalizeJpRarity(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "Unknown";
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Setnamnet utan leverantörens "(Japanese)"-markör — språket bär kolumnen, inte namnet. */
export function cleanJpEpisodeName(name: string): string {
  return name.replace(/\s*\((japanese|japansk)\)\s*/i, " ").replace(/\s+/g, " ").trim();
}

/** Normaliserad nyckel för namnmatchning mellan leverantörens setnamn och våra. */
function setNameKey(name: string): string {
  return cleanJpEpisodeName(name)
    .replace(/\s*\([A-Za-z]{1,4}\d{1,2}[A-Za-z-]{0,3}\)\s*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function jpCardName(nameEn: string): string {
  return `${nameEn.trim()} (JP)`;
}

/**
 * Titeln följer de engelska singlarnas form ("Venusaur ex · 151 3/165"): setets
 * NAMN utan kodsuffixet. Koden ("(SV6a)") finns på CardSet för att hålla isär
 * JP/EN-set med samma namn i set-väljaren — i en produkttitel är den bara brus
 * (ägarbeslut 2026-08-30).
 */
export function jpProductTitle(nameEn: string, setName: string, number: string, printed: number | null): string {
  const num = printed && printed > 0 ? `${number}/${printed}` : number;
  const plainSet = setName.replace(/\s*\([A-Za-z0-9-]{1,6}\)\s*$/, "").trim();
  return `${jpCardName(nameEn)} · ${plainSet} ${num}`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function runJapaneseSinglesRefresh(
  opts: { maxPages?: number; log?: (s: string) => void } = {}
): Promise<JpSinglesResult> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const res: JpSinglesResult = {
    apiCalls: 0, remaining: Infinity, cards: 0, setsCreated: 0, cardsCreated: 0,
    productsCreated: 0, offersWritten: 0, historyPoints: 0, skippedNoEpisode: 0, skippedNoName: 0,
    cmIdDisagreements: 0,
  };
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";
  if (!KEY) {
    console.warn("[cm-jp-singles] CARDMARKET_RAPIDAPI_KEY saknas — hoppar över.");
    return res;
  }
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) {
    console.warn("[cm-jp-singles] Retailer 'Cardmarket' saknas — hoppar över.");
    return res;
  }

  async function api<T>(url: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
      res.apiCalls++;
      const rem = r.headers.get("x-ratelimit-requests-remaining");
      if (rem != null) res.remaining = parseInt(rem, 10);
      if (r.status === 429) throw new Error("[cm-jp-singles] RapidAPI-kvoten slut (429).");
      if (r.ok) return (await r.json()) as T;
      await sleep(1000 * (attempt + 1));
    }
    // ⛔ Fail loud: en tappad sida = tyst förlorade kort + priser (samma regel som
    // sealed-katalogen i cardmarket-refresh).
    throw new Error(`[cm-jp-singles] ${url} misslyckades efter 3 försök.`);
  }

  // ── 1. Hämta hela listan ────────────────────────────────────────────────────
  const cards: JpApiCard[] = [];
  let page = 1;
  let total = 1;
  do {
    const d = await api<{ data: JpApiCard[]; paging: { total: number } }>(`https://${HOST}/pokemon-jp/cards?page=${page}`);
    total = d.paging?.total ?? 1;
    cards.push(...(d.data ?? []));
    page++;
    if (opts.maxPages && page > opts.maxPages) break;
    await sleep(THROTTLE_MS);
  } while (page <= total);
  res.cards = cards.length;
  log(`[cm-jp-singles] ${cards.length} kort på ${page - 1} sidor (kvot kvar ${res.remaining}).`);
  if (cards.length === 0) return res;

  // ── 2. Set: matcha befintliga JP-set på KOD, sedan namn; skapa resten ───────
  const jpSets = await prisma.cardSet.findMany({
    where: { language: "JP" },
    select: { id: true, name: true, externalId: true, totalCards: true, totalCardsFull: true, logoUrl: true },
  });
  const byExternal = new Map(jpSets.filter((s) => s.externalId).map((s) => [s.externalId!, s]));
  const byCode = new Map<string, (typeof jpSets)[number]>();
  const byName = new Map<string, (typeof jpSets)[number]>();
  for (const s of jpSets) {
    const code = codeFromJpSetName(s.name);
    if (code && !byCode.has(code.toLowerCase())) byCode.set(code.toLowerCase(), s);
    const key = setNameKey(s.name);
    if (key && !byName.has(key)) byName.set(key, s);
  }

  const episodes = new Map<number, NonNullable<JpApiCard["episode"]>>();
  for (const c of cards) if (c.episode?.id) episodes.set(c.episode.id, c.episode);
  const setIdByEpisode = new Map<number, string>();
  const setNameByEpisode = new Map<number, string>();
  for (const ep of episodes.values()) {
    const ext = `${JP_EXTERNAL_PREFIX}${ep.id}`;
    const clean = cleanJpEpisodeName(ep.name);
    const printed = ep.cards_printed_total ?? 0;
    const full = ep.cards_total ?? 0;
    let set =
      byExternal.get(ext) ??
      (ep.code ? byCode.get(ep.code.toLowerCase()) : undefined) ??
      byName.get(setNameKey(ep.name));
    if (!set) {
      const name = jpSetDisplayName(clean, ep.code);
      const created = await prisma.cardSet.create({
        data: {
          name,
          series: ep.series?.name?.trim() || "Other",
          releaseDate: ep.released_at ? new Date(ep.released_at) : null,
          // Leverantörens logotyp tills någon kör scripts/fetch-jp-set-logos.ts
          // (som lägger en lokal fil och pekar om) — samma regel som förr.
          logoUrl: ep.logo,
          externalId: ext,
          language: "JP",
          totalCards: printed,
          totalCardsFull: full,
        },
        select: { id: true, name: true, externalId: true, totalCards: true, totalCardsFull: true, logoUrl: true },
      });
      res.setsCreated++;
      set = created;
      byExternal.set(ext, created);
    } else {
      // Talen har varit 0 (= okänt) på JP-set eftersom vi saknade singlar. Nu finns
      // de: printedTotal = talet på kortet ("1/81"), fullt antal = leverantörens.
      const data: { totalCards?: number; totalCardsFull?: number } = {};
      if (printed > 0 && set.totalCards !== printed) data.totalCards = printed;
      if (full > 0 && set.totalCardsFull !== full) data.totalCardsFull = full;
      if (Object.keys(data).length) await prisma.cardSet.update({ where: { id: set.id }, data });
    }
    setIdByEpisode.set(ep.id, set.id);
    setNameByEpisode.set(ep.id, set.name);
  }

  // ── 3. Kort + produkt + offer ───────────────────────────────────────────────
  const rates = await getRatesOre();
  const today = utcToday();
  const existingCards = await prisma.card.findMany({
    where: { tcgExternalId: { startsWith: JP_EXTERNAL_PREFIX } },
    select: { id: true, tcgExternalId: true, cardmarketId: true, products: { where: { language: "JP" }, select: { id: true, slug: true }, take: 1 } },
  });
  const cardByExt = new Map(existingCards.map((c) => [c.tcgExternalId!, c]));
  const priced: { productId: string; priceOre: number }[] = [];

  await mapPool(cards, DB_CONCURRENCY, async (c) => {
    if (!c.episode?.id) { res.skippedNoEpisode++; return; }
    const nameEn = (c.name_en ?? "").trim();
    if (!nameEn) { res.skippedNoName++; return; }
    const setId = setIdByEpisode.get(c.episode.id);
    if (!setId) { res.skippedNoEpisode++; return; }
    const ext = `${JP_EXTERNAL_PREFIX}${c.id}`;
    const number = String(c.card_number ?? "").trim() || "?";
    const cardName = jpCardName(nameEn);
    const rarity = normalizeJpRarity(c.rarity);

    const existing = cardByExt.get(ext);
    let cardId: string;
    if (existing) {
      cardId = existing.id;
      await prisma.card.update({
        where: { id: cardId },
        data: { name: cardName, setId, number, rarity, imageUrl: c.image ?? undefined, artist: c.artist?.name ?? undefined, language: "JP" },
      });
    } else {
      const created = await prisma.card.create({
        data: { name: cardName, setId, number, rarity, imageUrl: c.image, artist: c.artist?.name ?? null, language: "JP", tcgExternalId: ext },
        select: { id: true },
      });
      cardId = created.id;
      res.cardsCreated++;
    }

    const setName = setNameByEpisode.get(c.episode.id) ?? cleanJpEpisodeName(c.episode.name);
    const title = jpProductTitle(nameEn, setName, number, c.episode.cards_printed_total ?? null);
    let productId = existing?.products[0]?.id;
    if (productId) {
      await prisma.product.update({ where: { id: productId }, data: { title, normalizedTitle: normalizeTitle(title), imageUrl: c.image ?? undefined, setId } });
    } else {
      const baseSlug = slugify(`${nameEn}-jp-${c.episode.code ?? c.episode.id}-${number}`);
      let slug = baseSlug;
      if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${baseSlug}-${c.id}`;
      const created = await prisma.product.create({
        data: {
          title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD", language: "JP",
          cardId, setId, imageUrl: c.image,
        },
        select: { id: true },
      });
      productId = created.id;
      res.productsCreated++;
    }

    // Pris + länk. Riktig produktsida vinner den dag leverantören ger cardmarket_id.
    const from = priceOreFromEur(c.prices?.cardmarket?.lowest_near_mint_JP, rates);
    const avg = priceOreFromEur(c.prices?.cardmarket?.["30d_average"], rates);
    const priceOre = from ?? avg;
    const stock = from ? "IN_STOCK" : "OUT_OF_STOCK";
    // ⛔ VÅRT cardmarketId VINNER. Det sattes ur CM:s egen katalog och verifierades
    // mot riktiga produktsidor (link-jp-singles-to-cardmarket.ts). Ett avvikande id
    // från leverantören skrivs ALDRIG över det — det loggas, så avvikelsen syns.
    // Saknar kortet id fyller leverantörens id luckan, och skrivs då även på kortet.
    let cmId = existing?.cardmarketId ?? null;
    if (cmId && c.cardmarket_id && c.cardmarket_id !== cmId) {
      res.cmIdDisagreements++;
    } else if (!cmId && c.cardmarket_id) {
      cmId = c.cardmarket_id;
      await prisma.card.update({ where: { id: cardId }, data: { cardmarketId: cmId } }).catch(() => {
        // Unikt index: id:t ägs redan av ett annat kort → lita inte på det.
        cmId = null;
      });
    }
    const url = cmId ? cardmarketJapaneseProductUrl(cmId) : cardmarketJpSearchUrl(nameEn);
    const key = { productId, retailerId: cm.id, condition: "NEAR_MINT" as const, language: "JP" as const };
    const current = await prisma.offer.findUnique({ where: { productId_retailerId_condition_language: key }, select: { url: true } });
    // En riktig produktsida skrivs ALDRIG över av söklänken.
    const keepUrl = current?.url && !isCardmarketJpSearchUrl(current.url) && isCardmarketJpSearchUrl(url) ? current.url : url;
    await prisma.offer.upsert({
      where: { productId_retailerId_condition_language: key },
      update: { price: priceOre, url: keepUrl, stockStatus: stock, lastSeenAt: new Date() },
      create: { ...key, price: priceOre, currency: "SEK", stockStatus: stock, url: keepUrl },
    });
    res.offersWritten++;
    if (priceOre) priced.push({ productId, priceOre });
  });

  // ── 4. Historik framåt ──────────────────────────────────────────────────────
  if (cmSource && priced.length > 0) {
    await prisma.priceObservation.createMany({
      data: priced.map((p) => ({ productId: p.productId, sourceId: cmSource.id, price: p.priceOre, currency: "SEK" })),
    });
    await upsertTodaySnapshots(priced, today);
    res.historyPoints = priced.length;
  }

  log(
    `[cm-jp-singles] Klart: ${res.cards} kort, ${res.setsCreated} nya set, ${res.cardsCreated} nya kort, ` +
      `${res.productsCreated} nya produkter, ${res.offersWritten} offers, ${res.historyPoints} historikpunkter` +
      (res.skippedNoEpisode || res.skippedNoName ? ` (hoppade över ${res.skippedNoEpisode} utan set, ${res.skippedNoName} utan namn)` : "") +
      (res.cmIdDisagreements ? ` ⚠️ ${res.cmIdDisagreements} kort där leverantörens cardmarket_id avviker från vårt (ignorerat)` : "") +
      `. ${res.apiCalls} API-anrop, kvot kvar ${res.remaining}.`
  );
  return res;
}
