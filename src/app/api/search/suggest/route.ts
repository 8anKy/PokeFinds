import type { NextRequest } from "next/server";
import type { ProductCategory } from "@prisma/client";
import { apiError, jsonCached } from "@/lib/api";
import { prisma } from "@/lib/db";
import { normalizeTitle } from "@/lib/utils";
import { HIDDEN_CATEGORIES, computeLowestPrice, computePriceChange7d } from "@/services/products";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { utcDaysAgo } from "@/lib/utils";
import { NOT_HIDDEN } from "@/lib/product-visibility";
import { isSealedCategory } from "@/lib/product-category";

/**
 * Sökförslag (autocomplete). KVOT-KRITISKT: får ALDRIG göra en Neon-fråga per
 * tangenttryckning. Hela den synliga katalogen (~21k produkter, några MB) hämtas
 * EN gång per dygn till en modul-global i minnet; varje förslags-request filtrerar
 * indexet i processen (~1 ms). OBS: medvetet INTE `cachedRead`/`unstable_cache` —
 * Next vägrar tyst att cacha poster >2 MB, vilket hade skickat varje tangent-
 * tryckning rakt till Neon.
 */

const MAX_SUGGESTIONS = 8;
/** Mobilens direktsök (`limit`) visar ett rutnät, inte en lista — men aldrig hela katalogen. */
const MAX_LIMIT = 48;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

interface IndexEntry {
  title: string;
  /** normalizedTitle från DB (samma normalisering som katalogsöket). */
  normalized: string;
  /** normalized utan mellanslag — fångar ihopskrivningar ("surgingsparks"). */
  compact: string;
  slug: string;
  imageUrl: string | null;
  setName: string | null;
  category: ProductCategory;
  viewCount: number;
  language: string;
  // Rutnätets kortfält (mobilens direktsök, 2026-10-25). Priset är indexets
  // ögonblicksbild (≤ 24 h gammal) — produktsidan visar alltid det levande.
  id: string;
  setId: string | null;
  setTotalCards: number | null;
  cardName: string | null;
  cardNumber: string | null;
  cardRarity: string | null;
  variantLabel: string | null;
  lowestPrice: number | null;
}

let indexCache: { at: number; promise: Promise<IndexEntry[]> } | null = null;

/**
 * ⛔ SIDVIS (2026-09-28): en findMany över ~46 000 produkter lade +107 MB på processen
 * (mätt mot prod), sidor om 2 000 +63 MB — resten är själva indexet. Minnet är den
 * största posten på Railway-notan, och indexet laddas om efter varje omstart.
 */
const INDEX_PAGE = 2000;

async function loadIndex(): Promise<IndexEntry[]> {
  const out: IndexEntry[] = [];
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.product.findMany({
      // Samma synlighetsregler som katalogen (buildProductWhere): prissatt, ej gömd
      // kategori, och inte bortgömd av ägaren (NOT_HIDDEN).
      where: { lowestPriceOre: { not: null }, category: { notIn: HIDDEN_CATEGORIES }, ...NOT_HIDDEN },
      select: {
        id: true,
        title: true,
        normalizedTitle: true,
        slug: true,
        imageUrl: true,
        category: true,
        viewCount: true,
        language: true,
        variantLabel: true,
        lowestPriceOre: true,
        setId: true,
        set: { select: { name: true, totalCards: true } },
        // Singlar hänger på setet via kortet (Product.setId är ofta null där).
        card: { select: { name: true, number: true, rarity: true, set: { select: { id: true, name: true, totalCards: true } } } },
      },
      orderBy: { id: "asc" },
      take: INDEX_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    for (const p of rows) {
      out.push({
        title: p.title,
        normalized: p.normalizedTitle.toLowerCase(),
        compact: p.normalizedTitle.toLowerCase().replace(/\s+/g, ""),
        slug: p.slug,
        imageUrl: p.imageUrl,
        setName: p.set?.name ?? p.card?.set?.name ?? null,
        category: p.category,
        viewCount: p.viewCount,
        language: p.language,
        id: p.id,
        setId: p.setId ?? p.card?.set?.id ?? null,
        setTotalCards: p.set?.totalCards ?? p.card?.set?.totalCards ?? null,
        cardName: p.card?.name ?? null,
        cardNumber: p.card?.number ?? null,
        cardRarity: p.card?.rarity ?? null,
        variantLabel: p.variantLabel,
        lowestPrice: p.lowestPriceOre,
      });
    }
    if (rows.length < INDEX_PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return out;
}

function getIndex(): Promise<IndexEntry[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.promise;
  const promise = loadIndex();
  indexCache = { at: Date.now(), promise };
  // Misslyckad hämtning får inte fastna i 24h — nästa request försöker igen.
  promise.catch(() => {
    if (indexCache?.promise === promise) indexCache = null;
  });
  return promise;
}

/**
 * LAGER + 7-DAGARSRÖRELSE (2026-10-26, ägaren: rutnätet ska visa samma "I lager" och
 * procent som katalogen). Egen karta med 1 h livslängd — lagret får inte stå ett dygn
 * gammalt som resten av indexet. Laddas om i BAKGRUNDEN: en sökning väntar aldrig på
 * den (gamla kartan, eller ingen, serveras under tiden), och omladdningen sker bara när
 * någon faktiskt söker — då är Neon redan vaken av appens övriga trafik.
 * Samma räkning som katalogens toListItem (direkta offers, lägsta köpbara).
 */
const LIVE_TTL_MS = 60 * 60 * 1000;
interface LiveEntry {
  price: number | null;
  stockStatus: string | null;
  change7d: number | null;
}
let liveCache: { at: number; map: Map<string, LiveEntry> } | null = null;
let liveLoading: Promise<void> | null = null;

async function loadLive(): Promise<Map<string, LiveEntry>> {
  const map = new Map<string, LiveEntry>();
  const since = utcDaysAgo(7);
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.product.findMany({
      where: { lowestPriceOre: { not: null }, category: { notIn: HIDDEN_CATEGORIES }, ...NOT_HIDDEN },
      select: {
        id: true,
        offers: { select: { price: true, stockStatus: true, url: true } },
        priceSnapshots: { where: { date: { gte: since } }, select: { date: true, avgPrice: true } },
      },
      orderBy: { id: "asc" },
      take: INDEX_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    for (const p of rows) {
      const lowest = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
      map.set(p.id, {
        price: lowest.price,
        stockStatus: lowest.stockStatus,
        change7d: computePriceChange7d(p.priceSnapshots).percent,
      });
    }
    if (rows.length < INDEX_PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return map;
}

/** Nuvarande karta (kan vara null första gången); startar en omladdning när den är gammal. */
function getLive(): Map<string, LiveEntry> | null {
  const stale = !liveCache || Date.now() - liveCache.at >= LIVE_TTL_MS;
  if (stale && !liveLoading) {
    liveLoading = loadLive()
      .then((map) => {
        liveCache = { at: Date.now(), map };
      })
      .catch((e) => console.error("[suggest] lagerkartan kunde inte laddas:", e instanceof Error ? e.message : e))
      .finally(() => {
        liveLoading = null;
      });
  }
  return liveCache?.map ?? null;
}

/** Lägre = bättre. null = ingen träff. */
function score(e: IndexEntry, qNorm: string, qCompact: string, words: string[]): number | null {
  const wordHit = words.every((w) => e.normalized.includes(w));
  if (!wordHit && !words.every((w) => e.compact.includes(w))) return null;
  if (e.normalized === qNorm) return 0;
  if (e.normalized.startsWith(qNorm) || e.compact.startsWith(qCompact)) return 1;
  if (e.normalized.includes(qNorm)) return 2;
  return 3;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const raw = (sp.get("q") ?? "").slice(0, 100);
    // `limit` + `kind` = mobilens direktsök (rutnät med kortfält). Utan dem: rubrikförslagen som förut.
    const limitParam = Number(sp.get("limit"));
    const grid = Number.isFinite(limitParam) && limitParam > 0;
    const limit = grid ? Math.min(MAX_LIMIT, Math.floor(limitParam)) : MAX_SUGGESTIONS;
    const kind = sp.get("kind");
    const lang = sp.get("lang");
    const setIds = new Set((sp.get("sets") ?? "").split(",").map((v) => v.trim()).filter(Boolean));
    const qNorm = normalizeTitle(raw);
    const words = qNorm
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean);
    if (qNorm.length < 2 || words.length === 0) return jsonCached({ items: [] }, 300);
    const qCompact = words.join("");

    const index = await getIndex();
    const matches: { e: IndexEntry; s: number }[] = [];
    for (const e of index) {
      if (kind === "cards" && e.category !== "SINGLE_CARD") continue;
      if (kind === "sealed" && !isSealedCategory(e.category)) continue;
      if (setIds.size > 0 && (!e.setId || !setIds.has(e.setId))) continue;
      if (lang && e.language !== lang) continue;
      const s = score(e, qNorm, qCompact, words);
      if (s !== null) matches.push({ e, s });
    }
    matches.sort(
      (a, b) =>
        a.s - b.s ||
        b.e.viewCount - a.e.viewCount ||
        a.e.title.length - b.e.title.length
    );

    const top = matches.slice(0, limit);
    const live = grid ? getLive() : null;
    const items = grid
      ? top.map(({ e }) => ({
          id: e.id,
          title: e.title,
          slug: e.slug,
          imageUrl: e.imageUrl,
          setName: e.setName,
          category: e.category,
          setId: e.setId,
          setTotalCards: e.setTotalCards,
          cardName: e.cardName,
          cardNumber: e.cardNumber,
          cardRarity: e.cardRarity,
          variantLabel: e.variantLabel,
          lowestPrice: live?.get(e.id)?.price ?? e.lowestPrice,
          stockStatus: live?.get(e.id)?.stockStatus ?? null,
          priceChange7d: live?.get(e.id)?.change7d ?? null,
        }))
      : top.map(({ e }) => ({
          title: e.title,
          slug: e.slug,
          imageUrl: e.imageUrl,
          setName: e.setName,
          category: e.category,
        }));
    return jsonCached({ items, total: matches.length }, 300);
  } catch (e) {
    return apiError(e);
  }
}
