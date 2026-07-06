import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Generera vid förfrågan, INTE vid build — annars kör en DB-fråga mot Neon under
// `next build` och en långsam/hängande anslutning fryser hela bygget.
export const dynamic = "force-dynamic";

/** Avbryter ett löfte efter `ms` så att en hängande DB-anslutning aldrig låser. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/produkter`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE_URL}/marknad`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${BASE_URL}/sets`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/priser`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/villkor`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/integritetspolicy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  let products: { slug: string; updatedAt: Date }[] = [];
  let sets: { id: string; updatedAt: Date }[] = [];
  try {
    [products, sets] = await withTimeout(
      Promise.all([
        prisma.product.findMany({
          select: { slug: true, updatedAt: true },
          orderBy: { viewCount: "desc" },
          // Hela katalogen (long-tail-SEO är sajtens poäng); sitemap-taket är 50k URL:er.
          take: 40000,
        }),
        prisma.cardSet.findMany({
          select: { id: true, updatedAt: true },
          take: 1000,
        }),
      ]),
      8000
    );
  } catch {
    // DB ej tillgänglig eller långsam — returnera bara de statiska rutterna.
    return staticRoutes;
  }

  // "weekly", inte "daily": daily fick Google att omcrawla tiotusentals produkt-
  // sidor per dygn → varje träff efter ISR-TTL = en DB-render på Neon. Priserna i
  // sök-snippets tål en veckas lagg; själva sidan är alltid ≤1h gammal vid besök.
  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${BASE_URL}/produkter/${p.slug}`,
    lastModified: p.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const setRoutes: MetadataRoute.Sitemap = sets.map((s) => ({
    url: `${BASE_URL}/sets/${s.id}`,
    lastModified: s.updatedAt,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...productRoutes, ...setRoutes];
}
