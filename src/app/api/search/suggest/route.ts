import type { NextRequest } from "next/server";
import type { ProductCategory } from "@prisma/client";
import { apiError, jsonCached } from "@/lib/api";
import { prisma } from "@/lib/db";
import { normalizeTitle } from "@/lib/utils";
import { HIDDEN_CATEGORIES } from "@/services/products";

/**
 * Sökförslag (autocomplete). KVOT-KRITISKT: får ALDRIG göra en Neon-fråga per
 * tangenttryckning. Hela den synliga katalogen (~21k produkter, några MB) hämtas
 * EN gång per dygn till en modul-global i minnet; varje förslags-request filtrerar
 * indexet i processen (~1 ms). OBS: medvetet INTE `cachedRead`/`unstable_cache` —
 * Next vägrar tyst att cacha poster >2 MB, vilket hade skickat varje tangent-
 * tryckning rakt till Neon.
 */

const MAX_SUGGESTIONS = 8;
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
}

let indexCache: { at: number; promise: Promise<IndexEntry[]> } | null = null;

function getIndex(): Promise<IndexEntry[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.promise;
  const promise = prisma.product
    .findMany({
      // Samma synlighetsregler som katalogen (buildProductWhere): prissatt + ej gömd kategori.
      where: { lowestPriceOre: { not: null }, category: { notIn: HIDDEN_CATEGORIES } },
      select: {
        title: true,
        normalizedTitle: true,
        slug: true,
        imageUrl: true,
        category: true,
        viewCount: true,
        set: { select: { name: true } },
        // Singlar hänger på setet via kortet (Product.setId är ofta null där).
        card: { select: { set: { select: { name: true } } } },
      },
    })
    .then((rows) =>
      rows.map((p) => ({
        title: p.title,
        normalized: p.normalizedTitle.toLowerCase(),
        compact: p.normalizedTitle.toLowerCase().replace(/\s+/g, ""),
        slug: p.slug,
        imageUrl: p.imageUrl,
        setName: p.set?.name ?? p.card?.set?.name ?? null,
        category: p.category,
        viewCount: p.viewCount,
      }))
    );
  indexCache = { at: Date.now(), promise };
  // Misslyckad hämtning får inte fastna i 24h — nästa request försöker igen.
  promise.catch(() => {
    if (indexCache?.promise === promise) indexCache = null;
  });
  return promise;
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
    const raw = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
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
      const s = score(e, qNorm, qCompact, words);
      if (s !== null) matches.push({ e, s });
    }
    matches.sort(
      (a, b) =>
        a.s - b.s ||
        b.e.viewCount - a.e.viewCount ||
        a.e.title.length - b.e.title.length
    );

    const items = matches.slice(0, MAX_SUGGESTIONS).map(({ e }) => ({
      title: e.title,
      slug: e.slug,
      imageUrl: e.imageUrl,
      setName: e.setName,
      category: e.category,
    }));
    return jsonCached({ items }, 300);
  } catch (e) {
    return apiError(e);
  }
}
