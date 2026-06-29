import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

// Wrappa med Sentry för full server-/route-felrapportering. Ingen authToken →
// källkartor laddas inte upp (minifierade stackar duger); silent + telemetry av.
// Bevarar headers/webpack/images ovan. (Var oskyldig till SW-reload-loopen.)
export default withSentryConfig(nextConfig, {
  org: "milos-t6",
  project: "foilio",
  silent: true,
  telemetry: false,
});
