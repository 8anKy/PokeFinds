/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["bullmq", "ioredis", "nodemailer", "redis-parser"],
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
