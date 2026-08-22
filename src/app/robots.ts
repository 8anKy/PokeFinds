import type { MetadataRoute } from "next";

// `||`, inte `??`: en saknad variabel expanderas till TOM STRÄNG (GitHub Actions,
// och en tom Railway-variabel beter sig likadant), och `"" ?? x` ger `""` — reserven
// hade aldrig använts och `Sitemap:`-raden pekat på `/sitemap.xml` utan värd.
// Reserven är prod-apex, inte localhost: en robots.txt som skickar crawlers till
// localhost är värdelös, och apex är kanonisk sedan 2026-08-14.
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

/**
 * Stängda vägar. DELAS av `*`-gruppen och Bingbot-gruppen — med flit.
 *
 * ⛔ EN CRAWLER LYDER EXAKT EN GRUPP (RFC 9309 §2.2.1): den mest specifika grupp vars
 * namn matchar, och den ÄRVER INGENTING från `*`. Bingbot-gruppen nedan hade därför
 * bara `allow: "/"` + `crawlDelay` och var i praktiken en FRISEDEL: Bing var
 * uttryckligen tillåten att krypa `/produkter?…`, `/api`, `/admin`, `/dashboard` och
 * `/installningar` — exakt den oändliga URL-rymd som `*`-gruppen stänger av
 * Neon-kostnadsskäl (varje träff = dynamisk render = väckt compute, och en väckning
 * kostar minst 300 s debiterad tid). Crawl-delayen bromsade takten men ändrade inte
 * VAD som fick krypas.
 *
 * Dupliceringen är alltså inte slarv utan protokollet — varje grupp måste bära hela
 * sin egen lista. Konstanten finns för att de två aldrig ska kunna glida isär igen:
 * en ny rad här slår igenom i BÅDA grupperna, vilket var precis det som misslyckades
 * när listorna stod skrivna två gånger.
 */
// ⛔ `Disallow` är PREFIXMATCHNING, inte segmentmatchning. Varje väg under `[locale]`
// finns i TVÅ former — oprefixad (svenska, next-intl `localePrefix: "as-needed"`) och
// `/en/`-prefixad — och den oprefixade regeln täcker INTE den engelska tvillingen.
// Bara `/produkter?` hade sin tvilling skriven för hand; de åtta app-vägarna saknade
// sina, så `/en/dashboard`, `/en/skanna`, `/en/admin` … var fritt krypbara och 307:ade
// (en dynamisk render per krypning — exakt den Neon-yta listan skrevs för att stänga).
// Tvillingarna HÄRLEDS därför nedan i stället för att skrivas två gånger: samma skäl
// som gruppduplicering ovan, samma felkälla om de får glida isär.
//
// ⚠️ Prefixmatchningen skär åt andra hållet också: `/mer` blockerar även ett framtida
// `/merch`. Ingen kollision i dagens rutträd (`/mer` + `/mer/bjud-in`).
const LOCALIZED = [
  "/admin",
  "/dashboard",
  "/installningar",
  // Inloggade app-vyer. Ingenting att indexera (auth-grindade — en crawler ser bara
  // inloggningsväggen), men varje hämtning är ändå en dynamisk render som väcker
  // computen, och de indexerade väggarna konkurrerar dessutom med riktiga sidor i
  // varumärkessök (samma fel som `/logga-in` gjorde innan den fick noindex).
  //
  // ⚠️ Sidfoten (`src/components/layout/site-footer.tsx`) länkar till `/skanna`.
  // Det är avsiktligt och ofarligt: länken finns för BESÖKAREN, och en internt
  // länkad men blockerad URL ger ingen ranknings-straff — Search Console noterar
  // den som "Blockerad av robots.txt", vilket är exakt vad vi menar med den.
  "/bevakningar",
  "/samling",
  "/mer",
  "/skanna",
  "/gradera",
  // /produkter?… (filter/sök/paginering) är en oändlig URL-rymd av dynamiska
  // renders (varje träff = Neon-frågor). Produkterna nås ändå via sitemap +
  // /produkter utan query + set-sidorna, så inget innehåll göms för Google.
  "/produkter?",
];

// `/api` ligger UTANFÖR `[locale]`-segmentet (`src/app/api/`) och har ingen `/en/`-tvilling
// — den ska inte härledas, bara blockeras rakt av.
const DISALLOW = [
  "/api",
  ...LOCALIZED,
  ...LOCALIZED.map((path) => `/en${path}`),
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
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
          // Anthropics nyare crawler-UA:er — Claude-SearchBot svepte katalogen i
          // 5,7 req/s (63 % av all trafik) 2026-08-09 och höll Neon vaken dygnet runt.
          "Claude-SearchBot",
          "Claude-User",
          "anthropic-ai",
          // Googles icke-sök-crawler (R&D/AI-hämtningar). Sökindexeringen görs av
          // Googlebot (egen UA) och påverkas inte av att den här blockas.
          "GoogleOther",
          "CCBot",
          "Bytespider",
          "AhrefsBot",
          "SemrushBot",
          "DataForSeoBot",
          "MJ12bot",
          "Amazonbot",
          // Amazons ANDRA crawler-UA. `Amazonbot` täcker den INTE — namnen är olika
          // strängar, och den svepte /produkter/[slug] var ~10:e sekund dygnet runt
          // (35 % av all trafik 2026-08-22) tills den blockerades. Se blocked-bots.ts.
          "Amzn-SearchBot",
          // Okänd lågvärdes-crawler i samma svep. Ingen SEO-nytta för en svensk nischsajt.
          "ShapBot",
          "Meta-ExternalAgent",
          // Metas ANDRA bulk-crawler. Saknades här och i middleware och stod för
          // 78 % av all egress 2026-07-26. facebookexternalhit/meta-externalfetcher
          // (länkförhandsvisning, EN URL) lämnas kvar med flit.
          "Meta-WebIndexer",
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
        //
        // `disallow` MÅSTE upprepas här: gruppen ärver ingenting från `*` (se DISALLOW).
        userAgent: "Bingbot",
        allow: "/",
        disallow: DISALLOW,
        crawlDelay: 10,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
