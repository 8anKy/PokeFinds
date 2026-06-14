import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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
    [products, sets] = await Promise.all([
      prisma.product.findMany({
        select: { slug: true, updatedAt: true },
        orderBy: { viewCount: "desc" },
        take: 5000,
      }),
      prisma.cardSet.findMany({
        select: { id: true, updatedAt: true },
        take: 1000,
      }),
    ]);
  } catch {
    // DB ej tillgänglig (t.ex. vid build utan databas) — returnera statiska rutter.
    return staticRoutes;
  }

  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${BASE_URL}/produkter/${p.slug}`,
    lastModified: p.updatedAt,
    changeFrequency: "daily",
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
