import { describe, expect, it } from "vitest";
import { SITEMAP_NAMES, sitemapIndexXml, urlsetXml } from "@/services/sitemap";

describe("uppdelad sitemap", () => {
  it("indexet listar varje delkarta under /sitemaps/<namn>.xml", () => {
    const xml = sitemapIndexXml();
    expect(xml).toContain("<sitemapindex");
    for (const n of SITEMAP_NAMES) expect(xml).toContain(`/sitemaps/${n}.xml</loc>`);
  });

  it("urlset escapar och bär lastmod bara när den finns", () => {
    const xml = urlsetXml([{ loc: "https://foilio.se/a?b=1&c=2" }, { loc: "https://foilio.se/g", lastmod: "2026-10-07" }]);
    expect(xml).toContain("<loc>https://foilio.se/a?b=1&amp;c=2</loc></url>");
    expect(xml).toContain("<lastmod>2026-10-07</lastmod>");
  });
});
