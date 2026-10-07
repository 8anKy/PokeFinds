/**
 * /sitemaps/<namn>.xml — en delkarta (sidor, set, förseglat, kort, japanska kort).
 * Se src/services/sitemap.ts. `force-dynamic` så att ingen DB-fråga körs under
 * `next build`; datat bakom är ändå dygnscachat (`cachedRead`), och svaret bär ett
 * dygns `s-maxage` för Railways edge.
 */
import { SITEMAP_HEADERS, SITEMAP_NAMES, sitemapUrls, urlsetXml, type SitemapName } from "@/services/sitemap";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const name = params.name.replace(/\.xml$/, "");
  if (!(SITEMAP_NAMES as readonly string[]).includes(name) || !params.name.endsWith(".xml")) {
    return new Response("Not found", { status: 404 });
  }
  const urls = await sitemapUrls(name as SitemapName);
  // DB nere ⇒ 503 + Retry-After, aldrig en tom lista (Google läser ett tomt urlset som
  // "sektionen har inga sidor" och slutar besöka dem i rapporten).
  if (!urls) return new Response("Tillfälligt otillgänglig", { status: 503, headers: { "Retry-After": "3600" } });
  return new Response(urlsetXml(urls), { headers: SITEMAP_HEADERS });
}
