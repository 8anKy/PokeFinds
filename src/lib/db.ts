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
 * Är felet "anslutningen gick inte att få / dog", inte "frågan var fel"?
 *
 * ⛔ KODEN RÄCKER INTE SOM TEST. En KALLSTART mot en suspenderad Neon-endpoint ger en
 * `PrismaClientInitializationError` med `errorCode: undefined` — alltså varken `code`
 * eller `errorCode` att känna igen den på, bara namnet och texten "Can't reach database
 * server". 2026-08-04 15:15 UTC dödade exakt det hela dygnets Cardmarket-priser: jobbets
 * FÖRSTA fråga (`prisma.retailer.findFirst`) kom efter en lång DB-fri fas, endpointen
 * sov, och körningen dog efter 6 sekunder med exit 1. En vakt som bara läser `code`
 * hade släppt igenom det — därför tre oberoende signaler.
 */
export function isRetryableDbError(err: unknown): boolean {
  const e = err as { code?: string; errorCode?: string; name?: string; message?: string } | null;
  if (!e) return false;
  if (e.code && RETRYABLE_DB_CODES.has(e.code)) return true;
  if (e.errorCode && RETRYABLE_DB_CODES.has(e.errorCode)) return true;
  // Kallstart: initieringsfel bär ingen kod alls. Prisma kastar den BARA när klienten
  // inte fick någon anslutning — en trasig FRÅGA blir aldrig ett InitializationError.
  if (e.name === "PrismaClientInitializationError") return true;
  return /can't reach database server|connection closed|server has closed the connection/i.test(
    e.message ?? "",
  );
}

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
      if (!isRetryableDbError(err)) throw err; // riktigt fel → kasta direkt
      lastErr = err;
      const label = (err as { code?: string; name?: string }).code ?? (err as { name?: string }).name;
      const waitMs = Math.min(400 * 2 ** i, 8000); // 400, 800, 1600 … tak 8 s
      console.warn(`[db] ${label} (försök ${i + 1}/${attempts}) — Neon vaknar troligen, väntar ${waitMs} ms.`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/**
 * Väcker en suspenderad Neon-compute INNAN jobbet börjar arbeta.
 *
 * Ett batch-jobb har ETT tillfälle per dygn. Att låta dess första riktiga fråga bära
 * kallstarten betyder att en sovande endpoint kostar ett helt dygns data (se
 * `isRetryableDbError`). En billig `SELECT 1` med tålmodig retry gör kallstarten till
 * en väntan i stället för ett fel. `attempts = 8` ⇒ ~30 s tålamod, vilket är i storleks-
 * ordningen för en Neon-uppvakning efter lång suspension; misslyckas ALLA åtta är
 * databasen verkligen nere och då SKA jobbet dö rött.
 */
export async function ensureDbAwake(attempts = 8): Promise<void> {
  const t0 = Date.now();
  await withDbRetry(() => prisma.$queryRaw`SELECT 1`, attempts);
  const ms = Date.now() - t0;
  if (ms > 1000) console.log(`[db] Neon vaken efter ${ms} ms.`);
}
