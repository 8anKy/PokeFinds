import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/dashboard", "/installningar"],
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
          "ClaudeBot",
          "CCBot",
          "Bytespider",
          "AhrefsBot",
          "SemrushBot",
          "DataForSeoBot",
          "MJ12bot",
        ],
        disallow: "/",
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
