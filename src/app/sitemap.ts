import type { MetadataRoute } from "next";
import { cachedRead, STATIC_CACHE_TAG } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { NOT_HIDDEN } from "@/lib/product-visibility";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Generera vid förfrågan, INTE vid build — annars kör en DB-fråga mot Neon under
// `next build` och en långsam/hängande anslutning fryser hela bygget.
//
// ⚠️ `force-dynamic` gäller RENDERINGEN, inte datat: själva uppslaget går genom
// `cachedRead` nedan, så en crawler-träff kostar noll Neon-frågor inom TTL-fönstret.
export const dynamic = "force-dynamic";

/** Avbryter ett löfte efter `ms` så att en hängande DB-anslutning aldrig låser. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

interface SitemapRow {
  key: string;
  /** ISO-sträng, inte Date: `unstable_cache` serialiserar ändå returvärdet. */
  lastModified: string;
}

/**
 * Katalogens URL:er. VARFÖR CACHAD (2026-08-05): rutten är `force-dynamic`, så VARJE
 * crawler-träff körde `product.findMany({ take: 40000, orderBy: viewCount })` +
 * `cardSet.findMany({ take: 1000 })` mot Neon — två fullskanningar som väckte computen
 * och drog ~2-3 MB egress per hämtning. Googlebot/Bingbot/AI-crawlers hämtar sitemapen
 * flera gånger om dygnet.
 *
 * 24h TTL matchar `changeFrequency: "weekly"` nedan — en sitemap som är ett dygn gammal
 * är per definition färsk nog för det löftet.
 *
 * ⛔ EGEN TAGG, inte PRICE_CACHE_TAG: sitemapen innehåller inga priser, och prisjobbens
 * `/api/revalidate` hade annars slängt den 3-4 ggr/dygn — dvs cachen hade aldrig levt
 * ut sitt dygn.
 */
const getSitemapRows = cachedRead(
  async (): Promise<{ products: SitemapRow[]; sets: SitemapRow[] }> => {
    const [products, sets] = await Promise.all([
      prisma.product.findMany({
        // ⛔ Ägarens bortgömda produkter annonseras inte för crawlers. Sidorna SVARAR
        //    fortfarande på en direkt träff — Discord-embeddens produktlänk måste
        //    fungera — de ligger bara inte längre i sitemapen.
        where: { ...NOT_HIDDEN },
        select: { slug: true, updatedAt: true },
        orderBy: { viewCount: "desc" },
        // Hela katalogen (long-tail-SEO är sajtens poäng); sitemap-taket är 50k URL:er.
        take: 40000,
      }),
      prisma.cardSet.findMany({
        select: { id: true, updatedAt: true },
        take: 1000,
      }),
    ]);
    return {
      products: products.map((p) => ({
        key: p.slug,
        lastModified: p.updatedAt.toISOString(),
      })),
      sets: sets.map((s) => ({ key: s.id, lastModified: s.updatedAt.toISOString() })),
    };
  },
  "sitemapRows",
  86400,
  [STATIC_CACHE_TAG]
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ⛔ `/` står INTE med: den omdirigerar till /produkter sedan startsidan togs bort
  // (2026-08-06), och en omdirigerande URL i en sitemap rapporteras av Search Console
  // som ett fel ("Page with redirect") i stället för att indexeras. Målet listas i
  // stället som sajtens viktigaste sida.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/produkter`, changeFrequency: "hourly", priority: 1 },
    { url: `${BASE_URL}/marknad`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${BASE_URL}/sets`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/priser`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/villkor`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/integritetspolicy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  let products: SitemapRow[] = [];
  let sets: SitemapRow[] = [];
  try {
    ({ products, sets } = await withTimeout(getSitemapRows(), 8000));
  } catch {
    // DB ej tillgänglig eller långsam — returnera bara de statiska rutterna.
    return staticRoutes;
  }

  // "weekly", inte "daily": daily fick Google att omcrawla tiotusentals produkt-
  // sidor per dygn → varje träff efter ISR-TTL = en DB-render på Neon. Priserna i
  // sök-snippets tål en veckas lagg; själva sidan är alltid ≤1h gammal vid besök.
  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${BASE_URL}/produkter/${p.key}`,
    lastModified: p.lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const setRoutes: MetadataRoute.Sitemap = sets.map((s) => ({
    url: `${BASE_URL}/sets/${s.key}`,
    lastModified: s.lastModified,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...productRoutes, ...setRoutes];
}
