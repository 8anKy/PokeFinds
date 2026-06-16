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
