import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /produkter?… (filter/sök/paginering) är en oändlig URL-rymd av dynamiska
        // renders (varje träff = Neon-frågor). Produkterna nås ändå via sitemap +
        // /produkter utan query + set-sidorna, så inget innehåll göms för Google.
        disallow: [
          "/admin",
          "/api",
          "/dashboard",
          "/installningar",
          "/produkter?",
          "/en/produkter?",
        ],
      },
      {
        // Lågvärdes-crawlers som svepte hela ~20k-produktkatalogen var par sekund
        // → varje slug = ISR cache-miss → DB-render → höll Neon-computen vaken
        // dygnet runt (aldrig scale-to-zero). Ingen SEO-nytta för en svensk
        // nischsajt. De här respekterar robots.txt. Behåll Google/Bing.
        // Vill du behålla Apple-indexering: byt Applebots Disallow mot crawlDelay.
        userAgent: [
          "Applebot",
          "Applebot-Extended",
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-Web",
          "anthropic-ai",
          "CCBot",
          "Bytespider",
          "AhrefsBot",
          "SemrushBot",
          "DataForSeoBot",
          "MJ12bot",
          "Amazonbot",
          "Meta-ExternalAgent",
          "PerplexityBot",
          "Perplexity-User",
          "YandexBot",
          "Baiduspider",
          "SeznamBot",
          "DotBot",
          "BLEXBot",
          "Barkrowler",
          "ImagesiftBot",
          "Timpibot",
          "Diffbot",
          "omgilibot",
        ],
        disallow: "/",
      },
      {
        // Bingbot behåller vi (SEO) men bromsar: den sveper gärna hela katalogen i ett
        // svep, och varje kall produktsida kostar ~50 Neon-frågor. Bing HEDRAR
        // crawl-delay (Google ignorerar den — Googles takt styrs i Search Console).
        userAgent: "Bingbot",
        allow: "/",
        crawlDelay: 10,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
