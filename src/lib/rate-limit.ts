/**
 * Enkel rate limiting. Använder Redis om tillgänglig, annars in-memory.
 * In-memory fungerar för en enskild instans (dev/MVP).
 */
import { getRedis } from "@/lib/queue";

const memory = new Map<string, { count: number; resetAt: number }>();

// Nedgraderingen Redis → in-memory får aldrig ske TYST i prod: per-instans-räknare
// nollas vid varje deploy och delas inte mellan instanser (brute force-skyddet
// försvagas). En rad per process räcker — inte en per anrop.
let warnedDegraded = false;
function warnDegraded(err: unknown) {
  if (warnedDegraded) return;
  warnedDegraded = true;
  console.error("[rate-limit] Redis onåbar — degraderar till in-memory (per instans):", err);
}

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
    } catch (err) {
      // Redis konfigurerad men onåbar (servern nere) → degradera graciöst till
      // in-memory istället för att 500:a. Per-instans, men funktionellt i dev.
      warnDegraded(err);
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

/** Läser räknaren UTAN att öka den (för "räkna bara misslyckanden"-mönster). */
export async function peekRateLimit(key: string): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const v = await redis.get(`ratelimit:${key}`);
      return v ? parseInt(v, 10) : 0;
    } catch {
      // faller igenom till in-memory
    }
  }
  const entry = memory.get(key);
  if (!entry || entry.resetAt < Date.now()) return 0;
  return entry.count;
}

/** Nollställer en räknare (t.ex. lyckad inloggning rensar misslyckade försök). */
export async function clearRateLimit(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(`ratelimit:${key}`);
      return;
    } catch {
      // faller igenom till in-memory
    }
  }
  memory.delete(key);
}
