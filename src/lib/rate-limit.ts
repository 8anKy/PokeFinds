/**
 * Enkel rate limiting. Använder Redis om tillgänglig, annars in-memory.
 * In-memory fungerar för en enskild instans (dev/MVP).
 */
import { getRedis } from "@/lib/queue";

const memory = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: boolean; remaining: number }> {
  const redis = getRedis();
  if (redis) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.pexpire(redisKey, windowMs);
      return { ok: count <= limit, remaining: Math.max(0, limit - count) };
    } catch {
      // Redis konfigurerad men onåbar (servern nere) → degradera graciöst till
      // in-memory istället för att 500:a. Per-instans, men funktionellt i dev.
    }
  }
  // In-memory fallback
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  entry.count++;
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}
