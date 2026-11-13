/**
 * ONE PIECE PÅ TRADERA — SPRÅKDOMEN PER ANNONS (2026-11-13) — ren modul, ingen databas.
 *
 * Koden ("OP08-098") är densamma på det engelska och det japanska kortet, Traderas kategori bär
 * inget språkattribut och ~1 av 6 annonser i stickprovet var japanska utan märke i titeln. Domen
 * tas därför på FOTOT (`scripts/op-listing-language.py`) och sparas per annons-id — en annons byter
 * inte bild, så den bedöms EN gång.
 *
 * ⛔ Bara `"en"` får sätta ett pris. Allt annat (japanskt, oklart, gick inte att rikta, ingen dom
 *    ännu) är "vet inte" och fälls — hellre inget Tradera-pris än ett japanskt pris på ett engelskt kort.
 */

export type OpLanguageVerdict = "en" | "jp" | "unclear" | "noalign" | "nojp" | "error";

export interface OpLanguageEntry {
  v: OpLanguageVerdict;
  /** likhet(engelsk) − likhet(japansk) på namnremsan. */
  d: number;
  /** Inliers i riktningen av fotot mot referensen. */
  n: number;
  /** När domen togs (ms). */
  t: number;
}

export type OpLanguageCache = Record<string, OpLanguageEntry>;

const VERDICTS = new Set<string>(["en", "jp", "unclear", "noalign", "nojp", "error"]);
/** Ett nätfel är ingen dom — annonsen prövas om nästa natt. */
const RETRY: ReadonlySet<OpLanguageVerdict> = new Set(["error"]);
/** En annons vi inte sett på så här länge är avslutad; domen behövs inte mer (sålt-svepet når ~45 d bak). */
export const OP_LANGUAGE_KEEP_MS = 60 * 24 * 3600_000;

/** Tolka cachefilen. Trasig/okänd form ⇒ tom cache (allt bedöms om), aldrig ett kast. */
export function parseOpLanguageCache(raw: string | null | undefined): OpLanguageCache {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: OpLanguageCache = {};
  for (const [id, e] of Object.entries(data as Record<string, unknown>)) {
    if (typeof e !== "object" || e === null) continue;
    const { v, d, n, t } = e as Record<string, unknown>;
    if (typeof v !== "string" || !VERDICTS.has(v)) continue;
    out[id] = {
      v: v as OpLanguageVerdict,
      d: typeof d === "number" ? d : 0,
      n: typeof n === "number" ? n : 0,
      t: typeof t === "number" ? t : 0,
    };
  }
  return out;
}

/** Har annonsen en dom som står sig? (`error` räknas inte — den prövas om.) */
export function settledVerdict(cache: OpLanguageCache, itemId: string): OpLanguageVerdict | null {
  const e = cache[itemId];
  return e && !RETRY.has(e.v) ? e.v : null;
}

/** Får annonsen sätta ett pris? Bara ett bevisat engelskt kort. */
export function isConfirmedEnglish(cache: OpLanguageCache, itemId: string): boolean {
  return cache[itemId]?.v === "en";
}

/** Traderas miniatyr (64 px) → fullstora bilden. `null` när adressen inte är en miniatyr vi känner igen. */
export function traderaPhotoUrl(thumbnail: string | null | undefined): string | null {
  if (!thumbnail || !/^https?:\/\/img\.tradera\.net\//.test(thumbnail)) return null;
  return thumbnail.replace(/\/(thumbs|medium)\//, "/images/");
}

export interface OpLanguageCandidate {
  itemId: string;
  code: string;
  productId: string;
  priceOre: number;
  photo: string;
  ref: string;
}

/**
 * Ordningen de obedömda annonserna prövas i när budgeten inte räcker till alla: produktens
 * BILLIGASTE annons först (det är den som blir priset), sedan näst billigaste för varje produkt osv.
 */
export function orderPendingByPriceRank<T extends { productId: string; priceOre: number }>(pending: readonly T[]): T[] {
  const byProduct = new Map<string, T[]>();
  for (const p of pending) (byProduct.get(p.productId) ?? byProduct.set(p.productId, []).get(p.productId)!).push(p);
  const ranked: { rank: number; item: T }[] = [];
  for (const list of byProduct.values()) {
    list.sort((a, b) => a.priceOre - b.priceOre);
    list.forEach((item, rank) => ranked.push({ rank, item }));
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.item.priceOre - b.item.priceOre).map((r) => r.item);
}

/** Nya domar in i cachen + bort med annonser vi inte sett på länge. Returnerar en NY cache. */
export function mergeOpLanguageCache(
  cache: OpLanguageCache,
  fresh: Record<string, { v: string; d?: number; n?: number }>,
  seenItemIds: ReadonlySet<string>,
  now: number
): OpLanguageCache {
  const out: OpLanguageCache = {};
  for (const [id, e] of Object.entries(cache)) {
    // En annons som syns i natt hålls vid liv; övriga åldras ut.
    if (seenItemIds.has(id)) out[id] = { ...e, t: now };
    else if (now - e.t < OP_LANGUAGE_KEEP_MS) out[id] = e;
  }
  for (const [id, e] of Object.entries(fresh)) {
    if (!VERDICTS.has(e.v)) continue;
    out[id] = { v: e.v as OpLanguageVerdict, d: e.d ?? 0, n: e.n ?? 0, t: now };
  }
  return out;
}
