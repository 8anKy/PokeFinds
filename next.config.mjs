/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["bullmq", "ioredis", "nodemailer", "redis-parser"],
    // Prebuilt deploy: vi bygger på Windows men Vercels runtime är Linux (rhel/OpenSSL 3).
    // Tvinga in Linux-Prisma-motorn i varje serverless-funktion så att @prisma/client
    // hittar rätt query engine i drift (annars "Query engine ... rhel-openssl-3.0.x not found").
    outputFileTracingIncludes: {
      "**/*": ["./node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node"],
    },
  },
  images: {
    remotePatterns: [
      // Officiell bild-CDN för Pokémon TCG API (kort-, logo- och symbolbilder)
      { protocol: "https", hostname: "images.pokemontcg.io" },
      // Övriga källor (avatarer, community-bilder) — snäva åt i prod vid behov
      { protocol: "https", hostname: "**" },
    ],
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

export default nextConfig;
