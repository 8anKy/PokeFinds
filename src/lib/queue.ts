/**
 * Redis-anslutning med graciös degradering.
 * Om REDIS_URL saknas eller anslutning misslyckas körs appen utan Redis
 * (in-memory rate limiting, synkrona jobb istället för BullMQ).
 */

// Webpack-säker require — __non_webpack_require__ ignoreras helt av webpack
// men fungerar som vanlig require() vid runtime i Node.js.
declare const __non_webpack_require__: typeof require;
const nodeRequire =
  typeof __non_webpack_require__ !== "undefined"
    ? __non_webpack_require__
    : require;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redis: any | null | undefined;

export function getRedis() {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    redis = null;
    return null;
  }
  try {
    const IoRedis = nodeRequire("ioredis").default || nodeRequire("ioredis");
    redis = new IoRedis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => (times > 2 ? null : 500),
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    redis.on("error", () => {
      // Tysta — fallback hanterar avsaknad av Redis
    });
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

export function isRedisAvailable(): boolean {
  const r = getRedis();
  return r !== null && r.status === "ready";
}
