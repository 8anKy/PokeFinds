import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
