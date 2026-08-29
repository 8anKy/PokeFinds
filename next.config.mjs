import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // SPEGLING, INTE EN ANDRA SANNING. Restock-larmen grindas av
  // `RESTOCK_ALERTS_PAUSED` (src/lib/restock-alerts-pause.ts), men de ytor som
  // LOVAR larm sitter i klientkomponenter under ISR-sidor och ser inga
  // server-env. Speglas här så det fortfarande finns exakt EN variabel att
  // ändra när larmen slås på igen.
  // ⛔ Defaulten är "1" (PAUSAT), samma fail-safe som serverfunktionen: hellre
  // ett gränssnitt som underdriver än ett som lovar en betalande kund larm som
  // aldrig kommer.
  // ⚠️ Bakas in vid BYGGET. En ändrad variabel i Railway kräver en ny deploy
  // (vilket Railway gör automatiskt vid env-ändring) — inte bara en omstart.
  env: {
    NEXT_PUBLIC_RESTOCK_ALERTS_PAUSED: process.env.RESTOCK_ALERTS_PAUSED ?? "1",
    // Samma mekanik, egen spak: prislarmen (PRICE_TARGET) pausades 2026-08-26 av helt
    // andra skäl än restock-larmen (tre olagade defekter, se price-alerts-pause.ts).
    // ⛔ EN FLAGGA PER FUNKTION. Slås de ihop går det inte att sätta tillbaka den ena
    // utan den andra, och den dagen kommer: restock väntar på kostnad, prislarm på en
    // lagning.
    NEXT_PUBLIC_PRICE_ALERTS_PAUSED: process.env.PRICE_ALERTS_PAUSED ?? "1",
    // Google-/Apple-inloggning: klient-id:n är PUBLIKA (står i appens binär) och
    // speglas hit så knapparna visas exakt när servern har providern. Bakas in
    // vid BYGGET — ny variabel i Railway ⇒ ny deploy. Se lib/social-login.ts.
    NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
    NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.GOOGLE_IOS_CLIENT_ID ?? "",
    NEXT_PUBLIC_APPLE_SERVICE_ID: process.env.APPLE_CLIENT_ID ?? "",
  },
  // Next håller renderade ISR-sidor + `unstable_cache`-poster i en minnes-LRU som
  // som standard får ta 50 MB. Det är resident minne dygnet runt, och minne är
  // ~92 % av Railway-notan (se Dockerfile). Sidorna ligger ÄVEN på disk i
  // containern, så en miss här kostar en filläsning (~1 ms) — inte en Neon-fråga.
  // Med p50-latens på 4 ms är det osynligt; med $10/GB-månad är 18 MB inte det.
  // Sänk INTE till 0: de hetaste sidorna ska fortfarande serveras ur minnet.
  cacheMaxMemorySize: 32 * 1024 * 1024,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["bullmq", "ioredis", "redis-parser"],
    // Prebuilt deploy: vi bygger på Windows men Vercels runtime är Linux (rhel/OpenSSL 3).
    // Tvinga in Linux-Prisma-motorn i varje serverless-funktion så att @prisma/client
    // hittar rätt query engine i drift (annars "Query engine ... rhel-openssl-3.0.x not found").
    outputFileTracingIncludes: {
      "**/*": ["./node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node"],
    },
  },
  images: {
    // Endast den officiella Pokémon-TCG-bild-CDN:en. Appen använder INTE next/image
    // (0 importer — allt är vanliga <img>), så bred "**" gjorde bara /_next/image
    // till en öppen optimizer-proxy (DoS/SSRF). Lås den.
    remotePatterns: [
      { protocol: "https", hostname: "images.pokemontcg.io" },
    ],
  },
  // Bas-säkerhetsheaders på alla svar. Striktare CSP (script/style-nonces) är ett
  // eget jobb — dessa fem är de billiga, brytningssäkra vinsterna.
  async headers() {
    return [
      {
        // Sitemapen är flera megabyte och svarade `max-age=0, must-revalidate` — dvs
        // INGEN cache alls. Varje crawler-hämtning (flera crawlers, flera gånger per
        // dygn) byggde och serialiserade om hela XML:en i en heap som är capad till
        // 512 MB (se Dockerfile), och en flermegabytes-sträng i den heapen är inte
        // gratis.
        //
        // Ett dygn är inte en gissning: datat BAKOM svaret är redan cachat exakt så
        // länge (`cachedRead("sitemapRows", 86400)` i src/app/sitemap.ts). Svaret kan
        // alltså inte bli färskare än 24h hur ofta vi än bygger om det — vi betalade
        // bara serialiseringen. `stale-while-revalidate` gör dessutom att hämtningen
        // efter utgången serveras direkt ur cachen medan nästa byggs i bakgrunden, så
        // ingen crawler får vänta på ett kallt bygge.
        //
        // ⚠️ `public` + `s-maxage` gäller DELADE cacher (Railways edge), inte en
        // webbläsare — en sitemap har inga besökare. Och till skillnad från
        // RSC-fallet nedan är edge-cachning här ofarlig: EN URL, ETT innehåll, ingen
        // `Vary`-dimension som nyckeln kan missa.
        //
        // ⚠️ SVARET BÄR TVÅ `Cache-Control`: den här och ruttens egen `public,
        // max-age=0, must-revalidate`. Config-headers LÄGGS TILL, de ersätter inte
        // ruttens — och `force-dynamic` i sitemap.ts är det som ger rutten sin (den
        // får inte tas bort: den finns för att ingen DB-fråga ska köras under
        // `next build`). RFC 9111 slår ihop fälten och `s-maxage` övertrumfar
        // `max-age` för en DELAD cache, så en edge cachar ändå ett dygn.
        //
        // ✅ UPPMÄTT I PRODUKTION 2026-08-17, inte resonerat fram: en förbikörning av
        // edgen (`?cb=…`) visar BÅDA fälten och `x-cache: MISS`; andra hämtningen av
        // samma URL ger `x-cache: HIT`. ⚠️ Railways edge ekar då tillbaka BARA
        // `max-age=0, must-revalidate` — den behåller `s-maxage` för sig själv. En
        // `curl -sI https://foilio.se/sitemap.xml` ser alltså ut som före ändringen
        // fast cachningen fungerar. Läs `x-cache`, inte `Cache-Control`, vid kontroll.
        //
        // ⛔ REGELN MÅSTE LIGGA FÖRE RSC-REGELN. Alla matchande header-regler körs, och
        // den SISTA som sätter samma nyckel vinner — låg den här efter RSC-regeln hade
        // ett (i dag omöjligt, men billigt att utesluta) RSC-flaggat anrop mot
        // /sitemap.xml fått `public, s-maxage=…` i stället för `no-store`, dvs exakt
        // den edge-förgiftning RSC-regeln finns för att omöjliggöra.
        //
        // Behövs den tömd i förtid (nya set): pusha en deploy — cachen är per
        // container. Sänk INTE värdet i stället; då är vi tillbaka i omserialiseringen.
        source: "/sitemap.xml",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=86400, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // RSC-FLIGHT-SVAR FÅR ALDRIG EDGE-CACHAS (incident 2026-07-05 + 2026-08-11):
        // Railways edge-CDN nycklar bara på URL (ignorerar Vary: RSC), så ett
        // klientnavigerings flight-svar (text/x-component) cachas under SAMMA
        // nyckel som HTML-dokumentet — nästa sidbesök får rå RSC-text, och på en
        // helt statisk sida (s-maxage=31536000) sitter giftet i ett år och
        // överlever deploys (auto-purgen tar bara HTML-klassen). /logga-in föll
        // 07-05, /en/community 08-11. ⛔ Middleware KAN inte fixa detta — Next
        // skriver över Cache-Control för prerendrade svar EFTER middleware
        // (verifierat mot byggd server 08-11); config-headers appliceras sist.
        source: "/:path*",
        has: [{ type: "header", key: "rsc" }],
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        // Universella länkar: Apple hämtar /.well-known/apple-app-site-association
        // och KRÄVER application/json. Filen är avsiktligt utan filändelse (Apples
        // krav) → `send` hittar ingen mime-typ och skulle svara
        // application/octet-stream; Apple sväljer filen tyst och länkarna öppnar i
        // Safari i stället för appen. Config-headers sätts före den statiska
        // filhanteraren, som bara sätter Content-Type om den saknas → vår vinner.
        // ⛔ Apple följer INTE redirects för den här filen: den måste ligga på
        // apex (foilio.se). Registrera aldrig applinks:www.foilio.se — Cloudflares
        // 301 www→apex ser ut som en korrekt konfiguration och verifierar aldrig.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // Kameran behövs för skannern (samma origin) → self; övrigt av.
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        string_decoder: false,
        net: false,
        tls: false,
        fs: false,
        child_process: false,
        dns: false,
        path: false,
        os: false,
        http: false,
        https: false,
        zlib: false,
      };
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
