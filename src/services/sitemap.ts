/**
 * SITEMAPEN, UPPDELAD PER SEKTION (2026-10-07). Var EN fil på 5,4 MB med 40 000 URL:er
 * (src/app/sitemap.ts, borttagen) — nu ett INDEX (`/sitemap.xml`) som pekar på fem
 * delkartor under `/sitemaps/<namn>.xml`.
 *
 * VARFÖR DELA: inte kostnad (svaret var redan dygnscachat — en DB-fråga/dygn) utan
 * MÄTNING. Search Console redovisar "indexerade" PER INSKICKAD SITEMAP, så med en fil
 * per sektion syns det direkt om Google tar förseglat men ratar japanska singlar.
 * Bonus: den gamla filen var kapad till 40 000 produkter (`take`) och tappade ~10 000
 * synliga produkter i svansen; varje delkarta ryms nu under protokollets 50 000.
 *
 * ⛔ INGEN `lastmod` på katalogen — skälet står kvar ordagrant nedan (från sitemap.ts).
 * ⛔ Gömda produkter står inte med (NOT_HIDDEN); sidorna svarar ändå på direkt träff.
 * ⛔ Bara SVENSKA URL:er: /en/-kopiorna pekar sin kanoniska URL på svenska
 *    (swedishCanonical), och en sitemap ska bara lista kanoniska URL:er.
 */
import { cachedRead, STATIC_CACHE_TAG } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { NOT_HIDDEN } from "@/lib/product-visibility";
import { getFeed } from "@/lib/feed-store";
import { newsFeedPublic } from "@/lib/news-feed-gate";
import { GUIDES } from "@/content/guides";

// `||`, inte `??`: en tom variabel (GitHub Actions/Railway) hade gett relativa URL:er,
// som är ogiltiga i en sitemap. Reserven är prod-apex, aldrig localhost.
export const SITEMAP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

/** Delkartorna, i den ordning indexet listar dem. Namnet är URL:en: /sitemaps/<namn>.xml */
export const SITEMAP_NAMES = ["sidor", "set", "forseglat", "kort", "kort-japanska"] as const;
export type SitemapName = (typeof SITEMAP_NAMES)[number];

interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

/** Avbryter ett löfte efter `ms` så att en hängande DB-anslutning aldrig låser. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/**
 * Katalogens URL-delar, cachade ett DYGN med egen tagg (aldrig PRICE_CACHE_TAG —
 * prisjobbens revalidering hade annars slängt dem 3–4 ggr/dygn). Rena strängar.
 * Skälen bakom varje filter står kvar från den gamla filen:
 *  · set: BARA set med minst en synlig produkt (ett tomt set är en tunn sida som
 *    Google klassar "Crawled – currently not indexed").
 *  · forumet: bara när COMMUNITY_V2_PUBLIC=1.
 */
const getSitemapRows = cachedRead(
  async (): Promise<{
    sealed: string[];
    singles: string[];
    singlesJp: string[];
    sets: string[];
    groups: string[];
    threads: string[];
  }> => {
    const forumPublic = (process.env.COMMUNITY_V2_PUBLIC ?? "").trim() === "1";
    const [products, sets, groups, threads] = await Promise.all([
      prisma.product.findMany({
        where: { ...NOT_HIDDEN },
        select: { slug: true, category: true, language: true },
        orderBy: { viewCount: "desc" },
      }),
      prisma.cardSet.findMany({
        where: { products: { some: { ...NOT_HIDDEN } } },
        select: { id: true, slug: true },
        take: 2000,
      }),
      forumPublic
        ? prisma.communityGroup.findMany({ select: { slug: true }, orderBy: { sortOrder: "asc" } })
        : Promise.resolve([]),
      forumPublic
        ? prisma.communityPost.findMany({
            where: { isHidden: false },
            select: { id: true },
            orderBy: { lastActivityAt: "desc" },
            take: 2000,
          })
        : Promise.resolve([]),
    ]);
    const sealed: string[] = [];
    const singles: string[] = [];
    const singlesJp: string[] = [];
    for (const p of products) {
      const isCard = p.category === "SINGLE_CARD" || p.category === "GRADED_CARD";
      if (!isCard) sealed.push(p.slug);
      else if (p.language === "JP") singlesJp.push(p.slug);
      else singles.push(p.slug);
    }
    return {
      sealed,
      singles,
      singlesJp,
      sets: sets.map((s) => s.slug || s.id),
      groups: groups.map((g) => g.slug),
      threads: threads.map((t) => t.id),
    };
  },
  "sitemapRowsV3",
  86400,
  [STATIC_CACHE_TAG]
);

const url = (path: string): string => `${SITEMAP_BASE_URL}${path}`;

/**
 * Statiska sidor + guider + (när ytorna är publika) forum, nyheter och evenemang.
 * Kommentarerna om VARFÖR en sida står med eller inte gäller från den gamla filen:
 *  · `/` står inte med (omdirigerar till /produkter — "Page with redirect").
 *  · `/community` står inte med (tunn platshållare).
 *  · nyheter/evenemang bara när `newsFeedPublic()` (en sitemap är en INBJUDAN).
 *  · guidernas `lastmod` är ÄRLIG — `updatedAt` sätts för hand när texten ändras.
 */
async function pageUrls(): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = [
    { loc: url("/produkter") },
    { loc: url("/sets") },
    { loc: url("/guider") },
    ...GUIDES.map((g) => ({ loc: url(`/guider/${g.slug}`), lastmod: g.updatedAt })),
    { loc: url("/priser") },
    { loc: url("/discord") },
    { loc: url("/om") },
    { loc: url("/kontakt") },
    { loc: url("/cookies") },
    { loc: url("/villkor") },
    { loc: url("/integritetspolicy") },
  ];
  try {
    const { groups, threads } = await withTimeout(getSitemapRows(), 8000);
    if (groups.length > 0) {
      urls.push(
        { loc: url("/forum") },
        ...groups.map((slug) => ({ loc: url(`/forum/g/${slug}`) })),
        ...threads.map((id) => ({ loc: url(`/forum/t/${id}`) }))
      );
    }
  } catch {
    /* DB nere ⇒ de statiska sidorna räcker för den här hämtningen */
  }
  try {
    if (newsFeedPublic()) {
      const { events, news } = await getFeed();
      urls.push(
        { loc: url("/nyheter") },
        { loc: url("/evenemang") },
        ...events.map((e) => ({ loc: url(`/evenemang/${e.slug}`) })),
        // Bara nyheter med EGEN text har en sida — en hämtad rubrik länkar ut.
        ...news.filter((n) => n.slug && n.body.length > 0).map((n) => ({ loc: url(`/nyheter/${n.slug}`) }))
      );
    }
  } catch {
    /* ingen flödesfil ⇒ inga sidor att bjuda in till */
  }
  return urls;
}

// ⛔ INGEN `lastmod` PÅ KATALOGEN (mätt 2026-08-17): `Product.updatedAt` stämplas av
// varje Prisma-skrivning (popularitetsnollningen, Tradera-svepets bokföring) medan den
// enda riktiga innehållsändringen (`recomputeProductPriceCache`, rå SQL) går FÖRBI
// kolumnen — signalen var omvänd. Ett falskt `lastmod` lär Google att strunta i fältet
// för hela sajten. Ingen kolumn duger som ersättning; utan fältet crawlar Google efter
// sina egna signaler.

/** URL:erna i en delkarta, eller `null` om datat inte gick att läsa (⇒ 503, Google försöker igen). */
export async function sitemapUrls(name: SitemapName): Promise<SitemapUrl[] | null> {
  if (name === "sidor") return pageUrls();
  let rows: Awaited<ReturnType<typeof getSitemapRows>>;
  try {
    rows = await withTimeout(getSitemapRows(), 8000);
  } catch {
    return null;
  }
  switch (name) {
    case "set":
      // Läsbar slug (lib/set-slug.ts); id bara för ett set som ännu saknar en.
      return rows.sets.map((slugOrId) => ({ loc: url(`/sets/${encodeURIComponent(slugOrId)}`) }));
    case "forseglat":
      return rows.sealed.map((slug) => ({ loc: url(`/produkter/${slug}`) }));
    case "kort":
      return rows.singles.map((slug) => ({ loc: url(`/produkter/${slug}`) }));
    case "kort-japanska":
      return rows.singlesJp.map((slug) => ({ loc: url(`/produkter/${slug}`) }));
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function urlsetXml(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function sitemapIndexXml(): string {
  const body = SITEMAP_NAMES.map((n) => `<sitemap><loc>${esc(url(`/sitemaps/${n}.xml`))}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/** Svarshuvudena — ett dygn i delade cacher, samma motivering som next.config.mjs. */
export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};
