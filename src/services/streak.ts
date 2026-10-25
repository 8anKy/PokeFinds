/**
 * Veckoserien mot databasen. Reglerna bor i lib/streak.ts (ren, testad).
 *
 * ⛔ KOSTNAD: en skrivning per användare och DYGN, inte per handling. Minnet håller
 * "redan bokförd idag" per process, så skanning nummer två samma dag rör aldrig
 * databasen här. Skrivningen sker dessutom i en request som redan väckt Neon (själva
 * handlingen skrev ju något) — veckoserien köper aldrig en egen väckning.
 *
 * ⛔ FÅR ALDRIG FÄLLA HANDLINGEN: ett fel här loggas och sväljs. En skanning som
 * lyckades men vars serie-bokföring misslyckades ska fortfarande vara en lyckad skanning.
 */
import { NextResponse } from "next/server";
import { HIDDEN_FEATURES } from "@/lib/hidden-features";
import type { PlanTier } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  HISTORY_WEEKS,
  STREAK_HEADER,
  addDays,
  computeStreak,
  stockholmDayKey,
  streakEvent,
  weekStart,
  type StreakEvent,
  type StreakReward,
  type StreakState,
} from "@/lib/streak";

const STATE_TTL_MS = 60_000;
const recordedToday = new Map<string, string>(); // userId → dagnyckel
const stateCache = new Map<string, { at: number; days: string[] }>();

function monthKeyNow(): string {
  // Samma gräns som kvoten (startOfMonthUtc).
  return new Date().toISOString().slice(0, 7);
}

async function loadDays(userId: string): Promise<string[]> {
  const hit = stateCache.get(userId);
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.days;
  const since = addDays(weekStart(stockholmDayKey()), -7 * HISTORY_WEEKS);
  const rows = await prisma.activityDay.findMany({
    where: { userId, day: { gte: new Date(`${since}T00:00:00Z`) } },
    select: { day: true },
  });
  const days = rows.map((r) => r.day.toISOString().slice(0, 10));
  stateCache.set(userId, { at: Date.now(), days });
  if (stateCache.size > 5000) stateCache.delete(stateCache.keys().next().value as string);
  return days;
}

export async function getStreakState(userId: string, planTier: PlanTier): Promise<StreakState> {
  const days = await loadDays(userId);
  return computeStreak(days, planTier, stockholmDayKey(), monthKeyNow());
}

/** Extra kvot denna månad från klara veckor. Admins har redan obegränsat ⇒ 0. */
export async function getStreakBonus(
  userId: string,
  planTier: PlanTier,
  role?: string | null
): Promise<StreakReward> {
  if (role === "ADMIN" || role === "SUPERADMIN") return { scans: 0, grades: 0 };
  try {
    return (await getStreakState(userId, planTier)).monthBonus;
  } catch (e) {
    console.error("[streak] bonus kunde inte läsas:", e instanceof Error ? e.message : e);
    return { scans: 0, grades: 0 };
  }
}

/**
 * Bokför dagens handling. Returnerar ett event BARA vid dagens första handling
 * (då firar appen), annars null.
 */
export async function recordActivity(
  userId: string,
  planTier: PlanTier
): Promise<StreakEvent | null> {
  if (HIDDEN_FEATURES.streak) return null; // dold (lib/hidden-features.ts): inget bokförs, inget firas
  const today = stockholmDayKey();
  if (recordedToday.get(userId) === today) return null;
  try {
    const { count } = await prisma.activityDay.createMany({
      data: [{ userId, day: new Date(`${today}T00:00:00Z`) }],
      skipDuplicates: true,
    });
    recordedToday.set(userId, today);
    if (recordedToday.size > 20000) recordedToday.clear();
    if (count === 0) return null; // redan bokförd (annan process / före omstart)
    stateCache.delete(userId);
    return streakEvent(await getStreakState(userId, planTier));
  } catch (e) {
    console.error("[streak] kunde inte bokföra dagen:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Sätter eventet som svarshuvud — appens StreakHost läser det och firar. */
export function withStreak<T extends Response>(res: T, event: StreakEvent | null): T {
  if (event) res.headers.set(STREAK_HEADER, encodeURIComponent(JSON.stringify(event)));
  return res;
}

/** Bekvämlighet för rutter som returnerar JSON. */
export function jsonWithStreak(body: unknown, event: StreakEvent | null, init?: ResponseInit) {
  return withStreak(NextResponse.json(body, init), event);
}
