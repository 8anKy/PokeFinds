import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Batch-jobb (GitHub Actions) sätter DB_POOL för att tillåta samtidiga skrivningar
// (mapPool) utan att slå i pool_timeout. Webb-appen sätter den inte → oförändrad.
const poolUrl = (() => {
  const base = process.env.DATABASE_URL;
  const pool = process.env.DB_POOL;
  if (!base || !pool) return undefined;
  return `${base}${base.includes("?") ? "&" : "?"}connection_limit=${pool}&pool_timeout=30`;
})();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(poolUrl ? { datasources: { db: { url: poolUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Prisma-felkoder som betyder "anslutningen dog", inte "frågan var fel".
 * P1017 = Server has closed the connection · P1001 = kan inte nå servern
 * P2024 = slut på anslutningar i poolen (timeout).
 */
const RETRYABLE_DB_CODES = new Set(["P1017", "P1001", "P2024"]);

/**
 * Kör en DB-operation med retry på ANSLUTNINGSfel (aldrig på riktiga frågefel).
 *
 * Varför: Neon skalar till noll (det är meningen — se Neon-kostnadsjobbet). Ett jobb
 * vars första DB-fråga kommer efter en lång DB-fri fas träffar då en SUSPENDERAD
 * compute, och Prisma får ibland P1017 "Server has closed the connection" i stället
 * för att vänta ut uppvaknandet. 2026-07-12 22:40 dödade exakt det hela restock-
 * skanningen och mejlade ett falskt fellarm — koden var felfri, endpointen sov bara.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (!code || !RETRYABLE_DB_CODES.has(code)) throw err; // riktigt fel → kasta direkt
      lastErr = err;
      const waitMs = 400 * 2 ** i; // 400, 800, 1600 ms — Neon vaknar på under en sekund
      console.warn(`[db] ${code} (försök ${i + 1}/${attempts}) — Neon vaknar troligen, väntar ${waitMs} ms.`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
