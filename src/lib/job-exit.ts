/**
 * AVSLUTA ETT JOBB ORDENTLIGT (2026-09-16).
 *
 * Ett batchjobb i GitHub Actions är klart när dess löfte löses — men Node lever
 * vidare så länge något handtag håller event-loopen: APNs HTTP/2-sessionen efter
 * ett prislarm, en flush-timer i analytics, en Prisma-pool. cardmarket-refresh
 * stod still i 97 minuter efter "Klart" den 2026-09-15 tills GitHubs 2-timmars-
 * gräns dödade den (fyra av elva körningar). Minuterna är gratis (publikt repo),
 * men en dödad körning märks röd och tar stegen efter sig med sig.
 *
 * Därför: stäng det vi vet håller loopen öppen, koppla ner Prisma, ge stdout
 * ett ögonblick att tömmas (rör-skrivningar är asynkrona på Linux) och avsluta
 * EXPLICIT. Anropas i runners' `.finally` i stället för en bar `$disconnect()`.
 */
import { prisma } from "@/lib/db";
import { shutdownPush } from "@/lib/apns";
import { flushAnalyticsEvents } from "@/services/analytics";

export async function exitJob(code = 0): Promise<never> {
  try {
    await flushAnalyticsEvents();
  } catch {
    // buffrade händelser är inte värda att blockera avslutet för
  }
  shutdownPush();
  try {
    await prisma.$disconnect();
  } catch {
    // redan nere
  }
  await new Promise((r) => setTimeout(r, 250));
  process.exit(code);
}
