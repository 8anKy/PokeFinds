/**
 * ONE PIECE (ENGELSKA) SEALED UR LEVERANTÖREN (2026-11-10, ägarbeslut: One Piece steg 1).
 *
 * Samma princip som Pokémon: katalogen växer BARA ur Cardmarket-identiteter (`idProduct`),
 * butikerna kopplas på det som finns. Källan är leverantörens One Piece-lista
 * (`/one-piece/episodes` ~5 sidor, `/one-piece/products` ~23 sidor à 20 ⇒ ~28 anrop/natt
 * av 15 000). ⛔ Leverantören har INGEN japansk One Piece (`/one-piece-jp/*` är tomt,
 * kontrollerat 2026-11-10) — allt här är engelskt.
 *
 * Gör tre saker, alla idempotenta:
 *  1. Ett `CardSet` per episod (`game: ONE_PIECE`, `externalId "tcggo-op:<id>"`).
 *  2. En produkt per sealed-rad med `cardmarket_id` som vi inte redan äger (via CM-offerns
 *     URL). Utan id skapas inget — identiteten gissas aldrig.
 *  3. CM-offerns pris = leverantörens `lowest` (CM:s From) i öre, med en enkel vakt mot
 *     30-dagarssnittet. Utan godkänt pris lämnas det gamla priset orört.
 *
 * ⛔ Tillbehör (sleeves, playmats, förvaring) och grossistenheter (Booster Box Case) skapas
 * aldrig — samma ägarbeslut som Pokémon. `hidden` (default AV sedan lanseringen 2026-11-10;
 * var PÅ medan katalogens spelfilter byggdes).
 */
import type { ProductCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRatesOre, priceOreFromEur } from "@/lib/exchange-rate";
import { cardmarketOnePieceProductUrl } from "@/lib/marketplace-urls";
import { normalizeTitle, slugify, utcToday } from "@/lib/utils";
import { decodeEntities } from "@/lib/rss";
import { guessListingCategory } from "@/scrapers/listing-category";

const THROTTLE_MS = 220;
const SET_EXTERNAL_PREFIX = "tcggo-op:";

const OP_SEALED_CATEGORIES = new Set<string>(["BOOSTER_PACK", "BOOSTER_BOX", "COLLECTION_BOX", "TIN", "BUNDLE", "BLISTER"]);
/**
 * Grossist: "Booster Box Case (12x Booster Box)", "Treasure Boosters Set Case" (släpptes igenom av
 * en smalare regel 2026-11-10). Varje "case" fälls — ett "Card Case" är tillbehör och fälls ändå.
 */
const WHOLESALE_RE = /\bcase\b/i;
/** Tillbehör som leverantören blandar in i produktlistan sedan 2026-11 (sleeves, dice, coins …). */
const ACCESSORY_RE =
  /\bsleeves?\b|\bplay\s?mat\b|\bplaymat\b|\bdeck\s*box\b|\bdeckbox\b|\bdeck\s*case\b|\bcard\s*case\b|\bbinder\b|\bportfolio\b|\balbum\b|\bdice\b|\bcoins?\b|\bpins?\b|\bstorage\b|\btoploader\b|\bdon!!\s*card\s*sleeve/i;

export interface OpApiEpisode {
  id: number;
  name: string;
  code?: string | null;
  released_at?: string | null;
  logo?: string | null;
  lang?: string | null;
}

export interface OpApiProduct {
  id: number;
  name: string;
  lang?: string | null;
  cardmarket_id: number | null;
  image?: string | null;
  prices?: { cardmarket?: { lowest?: number | null; available_items?: number | null; "30d_average"?: number | null } | null } | null;
  episode?: { id?: number | null } | null;
}

/** Ren dom: ska leverantörens rad bli en katalogprodukt, och i så fall vilken kategori? */
export function onePieceSealedCategory(name: string): ProductCategory | null {
  if (!name.trim() || WHOLESALE_RE.test(name) || ACCESSORY_RE.test(name)) return null;
  // "Starter Deck: Absolute Justice", "Ultra Deck: The Three Captains" — byggda lekdäck.
  if (/\b(starter|ultra)\s*deck\b/i.test(name)) return "COLLECTION_BOX";
  // Samlarprodukter butikerna säljer sealed (listan ur leverantörens katalog 2026-11-10):
  // Illustration Box, Premium Card Collection, Gift Collection, Devil Fruits Collection,
  // Special DON!! Set, Treasure Boosters Set, Anniversary Set.
  if (
    /\billustration\s*box\b|\bpremium\s*card\s*collection\b|\bgift\s*collection\b|\bdevil\s*fruits\s*collection\b|\bspecial\s*don!!\s*set\b|\btreasure\s*boosters?\s*set\b|\banniversary\s*set\b/i.test(name)
  )
    return "COLLECTION_BOX";
  // "Double Pack Set Vol. 4" — två boosters + DON!!-kort i en förpackning.
  if (/\bdouble\s*pack\b/i.test(name)) return "BUNDLE";
  // "Premium Booster -The Best-" är paket; lådan heter "... Booster Box".
  const cat = guessListingCategory(name);
  return OP_SEALED_CATEGORIES.has(cat) ? (cat as ProductCategory) : null;
}

/**
 * Ren dom: leverantörens `lowest` i EUR → godkänt pris eller null. ⛔ Ett From långt från
 * 30-dagarssnittet (en felprissatt annons, en glitch) blir INTE priset — det gamla står kvar.
 */
export function onePieceAcceptedEur(cm: NonNullable<OpApiProduct["prices"]>["cardmarket"]): number | null {
  const lowest = cm?.lowest;
  if (typeof lowest !== "number" || !(lowest > 0)) return null;
  if ((cm?.available_items ?? 0) <= 0) return null;
  const avg = cm?.["30d_average"];
  if (typeof avg === "number" && avg > 0 && (lowest < avg / 3 || lowest > avg * 3)) return null;
  return lowest;
}

export interface OpSealedImportResult {
  apiCalls: number;
  episodes: number;
  setsCreated: number;
  listed: number;
  created: number;
  priced: number;
  /** Dagens prispunkter (grafen byggs framåt, som för Pokémon). */
  historyPoints: number;
  skippedNoId: number;
  skippedFiltered: number;
  createdTitles: string[];
  filteredSamples: string[];
}

async function fetchAll<T>(path: string, host: string, key: string, res: OpSealedImportResult): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let total = 1;
  do {
    const r = await fetch(`https://${host}${path}?page=${page}`, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
    res.apiCalls++;
    // ⛔ Fail loud: en tappad sida = tyst uteblivna produkter.
    if (!r.ok) throw new Error(`[op-import] ${path}?page=${page} HTTP ${r.status}`);
    const d = (await r.json()) as { data?: T[]; paging?: { total?: number } };
    total = d.paging?.total ?? 1;
    out.push(...(d.data ?? []));
    page++;
    await new Promise((ok) => setTimeout(ok, THROTTLE_MS));
  } while (page <= total);
  return out;
}

export async function runOnePieceSealedImport(
  opts: { apply?: boolean; hidden?: boolean; log?: (s: string) => void } = {}
): Promise<OpSealedImportResult> {
  const apply = opts.apply ?? false;
  // Lanserat 2026-11-10 (ägarbeslut): nya One Piece-produkter skapas SYNLIGA, som Pokémon.
  const hidden = opts.hidden ?? false;
  const log = opts.log ?? ((s: string) => console.log(s));
  const res: OpSealedImportResult = {
    apiCalls: 0, episodes: 0, setsCreated: 0, listed: 0, created: 0, priced: 0, historyPoints: 0, skippedNoId: 0, skippedFiltered: 0,
    createdTitles: [], filteredSamples: [],
  };
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";
  if (!KEY) return res;
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) return res;
  const rates = await getRatesOre();

  // ── 1. Episoder → set ───────────────────────────────────────────────────────
  const episodes = (await fetchAll<OpApiEpisode>("/one-piece/episodes", HOST, KEY, res)).filter(
    (e) => (e.lang ?? "en") === "en"
  );
  res.episodes = episodes.length;
  const existingSets = new Map(
    (
      await prisma.cardSet.findMany({
        where: { externalId: { startsWith: SET_EXTERNAL_PREFIX } },
        select: { id: true, externalId: true },
      })
    ).map((s) => [s.externalId!, s.id])
  );
  const setIdByEpisode = new Map<number, string>();
  let codeColumn = true;
  for (const e of episodes) {
    const ext = `${SET_EXTERNAL_PREFIX}${e.id}`;
    let setId = existingSets.get(ext);
    if (!setId) {
      res.setsCreated++;
      if (!apply) continue;
      const created = await prisma.cardSet.create({
        data: {
          name: e.name,
          series: "One Piece",
          externalId: ext,
          game: "ONE_PIECE",
          language: "EN",
          releaseDate: e.released_at ? new Date(`${e.released_at}T00:00:00Z`) : null,
          logoUrl: e.logo ?? null,
        },
        select: { id: true },
      });
      setId = created.id;
    }
    setIdByEpisode.set(e.id, setId);
    // Setkoden ("OP-09", "EB05", "ST32") — butiksmatchningen dömer på den (lib/one-piece-listing).
    // Rå SQL + try: kolumnen kom i migrationen 20261110180000; saknas den hoppas steget tyst.
    if (apply && e.code && codeColumn) {
      try {
        await prisma.$executeRaw`UPDATE "CardSet" SET code = ${e.code} WHERE id = ${setId} AND code IS DISTINCT FROM ${e.code}`;
      } catch {
        codeColumn = false;
      }
    }
  }

  // ── 2. Produkter ────────────────────────────────────────────────────────────
  const items = await fetchAll<OpApiProduct>("/one-piece/products", HOST, KEY, res);
  res.listed = items.length;
  const offers = await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "/OnePiece/" } },
    select: { id: true, url: true, price: true, productId: true, product: { select: { title: true } } },
  });
  const offerByIdProduct = new Map<number, { id: string; price: number | null; productId: string; title: string }>();
  for (const o of offers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (m) offerByIdProduct.set(parseInt(m[1], 10), { id: o.id, price: o.price, productId: o.productId, title: o.product.title });
  }
  const points: { productId: string; priceOre: number }[] = [];

  for (const it of items) {
    // ⛔ Leverantören skickar HTML-kodade namn ("Ace &amp; Newgate", mätt 2026-11-10).
    const name = decodeEntities(it.name ?? "").trim();
    if ((it.lang ?? "en") !== "en") { res.skippedFiltered++; continue; }
    const category = onePieceSealedCategory(name);
    if (!category) {
      res.skippedFiltered++;
      if (res.filteredSamples.length < 25) res.filteredSamples.push(name);
      continue;
    }
    const idProduct = it.cardmarket_id;
    if (idProduct == null) { res.skippedNoId++; continue; }
    const eur = onePieceAcceptedEur(it.prices?.cardmarket ?? null);
    const priceOre = eur == null ? null : priceOreFromEur(eur, rates);
    const inStock = (it.prices?.cardmarket?.available_items ?? 0) > 0;

    const owned = offerByIdProduct.get(idProduct);
    if (owned) {
      if (priceOre != null && owned.productId) points.push({ productId: owned.productId, priceOre });
      // Självläkning: produkter skapade med det okodade namnet får rätt titel (slugen står kvar).
      if (apply && owned.productId && owned.title !== name && /&[a-z#0-9]+;/i.test(owned.title)) {
        await prisma.product.update({
          where: { id: owned.productId },
          data: { title: name, normalizedTitle: normalizeTitle(name) },
        });
      }
      if (priceOre != null && priceOre !== owned.price) {
        res.priced++;
        if (apply)
          await prisma.offer.update({
            where: { id: owned.id },
            data: { price: priceOre, stockStatus: inStock ? "IN_STOCK" : "OUT_OF_STOCK", lastSeenAt: new Date() },
          });
      }
      continue;
    }

    res.created++;
    if (priceOre != null) res.priced++;
    res.createdTitles.push(`${name} [${category}] #${idProduct}${priceOre != null ? ` ${(priceOre / 100).toFixed(0)} kr` : ""}`);
    offerByIdProduct.set(idProduct, { id: "", price: priceOre, productId: "", title: name });
    if (!apply) continue;

    let slug = slugify(`one piece ${name}`) || `one-piece-${idProduct}`;
    if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${idProduct}`;
    const setId = it.episode?.id != null ? setIdByEpisode.get(it.episode.id) ?? null : null;
    const product = await prisma.product.create({
      data: {
        title: name,
        normalizedTitle: normalizeTitle(name),
        slug,
        category,
        language: "EN",
        game: "ONE_PIECE",
        setId,
        imageUrl: it.image ?? null,
        hiddenAt: hidden ? new Date() : null,
      },
      select: { id: true },
    });
    if (priceOre != null) points.push({ productId: product.id, priceOre });
    await prisma.offer.create({
      data: {
        productId: product.id,
        retailerId: cm.id,
        condition: "SEALED",
        language: "EN",
        price: priceOre,
        currency: "SEK",
        stockStatus: priceOre != null && inStock ? "IN_STOCK" : "OUT_OF_STOCK",
        url: cardmarketOnePieceProductUrl(idProduct),
      },
    });
  }

  // Dagens prispunkt per prissatt produkt — samma upsert som Pokémon-sealed (en omkörning
  // samma dag ersätter punkten). Dynamisk import: cardmarket-refresh importerar det här jobbet.
  res.historyPoints = points.length;
  if (apply && points.length > 0) {
    const { upsertTodaySnapshots } = await import("@/jobs/cardmarket-refresh");
    await upsertTodaySnapshots(points, utcToday());
  }

  log(
    `[op-import] ${res.episodes} episoder (${res.setsCreated} nya set) · ${res.listed} produkter hos leverantören → ` +
      `${res.created} ${apply ? "skapade" : "SKULLE skapas"}${hidden ? " (dolda)" : ""}, ${res.priced} prissatta, ` +
      `${res.skippedNoId} utan CM-id (väntar), ${res.skippedFiltered} tillbehör/grossist. ${res.apiCalls} API-anrop.`
  );
  return res;
}
