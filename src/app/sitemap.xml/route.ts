/**
 * /sitemap.xml — sitemap-INDEXET (2026-10-07). Pekar på delkartorna under
 * /sitemaps/<namn>.xml; varför uppdelningen: src/services/sitemap.ts.
 * Ingen DB här — listan av delkartor är fast. robots.txt pekar hit som förut.
 */
import { SITEMAP_HEADERS, sitemapIndexXml } from "@/services/sitemap";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(sitemapIndexXml(), { headers: SITEMAP_HEADERS });
}
