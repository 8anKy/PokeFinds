/**
 * VECKOSERIEN (ägarbeslut 2026-10-18) — ren logik, ingen databas. Testad i
 * tests/unit/streak.test.ts.
 *
 * Reglerna, som ägaren formulerade dem:
 *   • En DAG räknas bara när användaren GJORT något den dagen (skannat, lagt till i
 *     samlingen, bevakat, postat/kommenterat/butiksrapport, AI-graderat) — att bara
 *     öppna appen räknas inte, precis som en lektion hos ett språkappsexempel.
 *   • En VECKA är måndag–söndag. Veckan är KLAR först när alla sju dagar har en handling.
 *   • En klar vecka ger påfyllning: gratis +10 skanningar +1 AI-gradering, Pro +2
 *     graderingar. Från vecka 4 i rad ×1,5 (avrundat uppåt).
 *   • En missad dag kostar veckans påfyllning men BRYTER INTE serien — veckoserien
 *     nollas först när en hel vecka passerar utan en enda handling.
 *   • Dagen bestäms av SERVERNS klocka i Europe/Stockholm. Telefonens klocka och
 *     tidszon används aldrig — då hade man kunnat "fylla" gårdagen i efterhand.
 *
 * Belöningen LAGRAS INTE: den räknas ur dagraderna varje gång, så en ändrad regel
 * gäller bakåt och det finns ingen saldotabell som kan glida isär från sanningen.
 * Påfyllningen läggs på MÅNADSKVOTEN direkt när veckan blir klar (söndagens handling),
 * för den månad söndagen ligger i (samma kalendermånad som kvoten räknas i).
 */

export type DayKey = string; // "YYYY-MM-DD", svensk kalenderdag

export type StreakPlan = "FREE" | "PREMIUM";

export interface StreakReward {
  scans: number;
  grades: number;
}

/** Påfyllningen för en klar vecka. Pro har redan 2 000 skanningar ⇒ bara graderingar. */
export const BASE_REWARD: Record<StreakPlan, StreakReward> = {
  FREE: { scans: 10, grades: 1 },
  PREMIUM: { scans: 0, grades: 2 },
};
/** Från den här veckan i rad blir påfyllningen större. */
export const BOOST_FROM_WEEK = 4;
export const BOOST_FACTOR = 1.5;

/** Hur långt bakåt tjänsten läser (veckor). Räcker för månadens påfyllningar + en lång serie. */
export const HISTORY_WEEKS = 26;

const STOCKHOLM = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Svensk kalenderdag för ett ögonblick (serverns klocka). */
export function stockholmDayKey(at: Date = new Date()): DayKey {
  return STOCKHOLM.format(at); // en-CA ger just "YYYY-MM-DD"
}

function toUtcDate(key: DayKey): Date {
  return new Date(`${key}T00:00:00Z`);
}

function fromUtcDate(d: Date): DayKey {
  return d.toISOString().slice(0, 10);
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = toUtcDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtcDate(d);
}

/** Måndagen i den vecka dagen ligger i. */
export function weekStart(key: DayKey): DayKey {
  const dow = toUtcDate(key).getUTCDay(); // 0 = söndag
  return addDays(key, -((dow + 6) % 7));
}

export function rewardFor(plan: StreakPlan, weekStreak: number): StreakReward {
  const base = BASE_REWARD[plan];
  if (weekStreak < BOOST_FROM_WEEK) return { ...base };
  return {
    scans: Math.ceil(base.scans * BOOST_FACTOR),
    grades: Math.ceil(base.grades * BOOST_FACTOR),
  };
}

export interface StreakDay {
  key: DayKey;
  done: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface StreakState {
  today: DayKey;
  /** Måndag → söndag i innevarande vecka. */
  week: StreakDay[];
  todayDone: boolean;
  daysThisWeek: number;
  /** Dagar i rad med en handling, t.o.m. idag (eller igår om idag inte är gjord än). */
  dayStreak: number;
  /** Veckor i rad med minst en handling, t.o.m. denna vecka (eller förra om denna är tom). */
  weekStreak: number;
  /** Kan veckan fortfarande bli klar? (Ingen passerad dag är missad.) */
  weekStillPossible: boolean;
  /** Vad en klar vecka ger NU (med ×1,5 när denna vecka blir vecka 4+). */
  nextReward: StreakReward;
  /** Påfyllningen förra veckan gav (null om förra veckan inte blev klar). */
  lastWeekReward: StreakReward | null;
  /** Summan av påfyllningar som gäller kvotens innevarande månad. */
  monthBonus: StreakReward;
}

/**
 * Bygger hela tillståndet ur de dagar användaren varit aktiv.
 * @param activeDays dagnycklar (ordning och dubbletter spelar ingen roll)
 * @param monthKey kvotmånaden "YYYY-MM" — klara veckor vars söndag ligger i den räknas
 */
export function computeStreak(
  activeDays: Iterable<DayKey>,
  plan: StreakPlan,
  today: DayKey,
  monthKey: string
): StreakState {
  const days = new Set(activeDays);
  const thisMonday = weekStart(today);

  const week: StreakDay[] = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(thisMonday, i);
    return { key, done: days.has(key), isToday: key === today, isFuture: key > today };
  });
  const todayDone = days.has(today);
  const daysThisWeek = week.filter((d) => d.done).length;
  const weekStillPossible = week.every((d) => d.done || d.key >= today);

  let dayStreak = 0;
  for (let k = todayDone ? today : addDays(today, -1); days.has(k); k = addDays(k, -1)) dayStreak++;

  // Veckor med minst en handling, äldst först, inom historikfönstret.
  const activeWeek = (monday: DayKey) =>
    Array.from({ length: 7 }, (_, i) => addDays(monday, i)).some((k) => days.has(k));
  const completeWeek = (monday: DayKey) =>
    Array.from({ length: 7 }, (_, i) => addDays(monday, i)).every((k) => days.has(k));

  /** Veckoserien som den såg ut VID veckan `monday` (räknat bakåt från den). */
  const streakAt = (monday: DayKey): number => {
    let n = 0;
    for (let m = monday; activeWeek(m) && n < HISTORY_WEEKS; m = addDays(m, -7)) n++;
    return n;
  };

  const lastMonday = addDays(thisMonday, -7);
  const weekStreak = activeWeek(thisMonday) ? streakAt(thisMonday) : streakAt(lastMonday);

  // Om denna vecka blir klar är den (minst) vecka streakAt(förra)+1 i rad.
  const nextReward = rewardFor(plan, streakAt(lastMonday) + 1);
  const lastWeekReward = completeWeek(lastMonday) ? rewardFor(plan, streakAt(lastMonday)) : null;

  const monthBonus: StreakReward = { scans: 0, grades: 0 };
  for (let i = 0; i <= 6; i++) {
    const monday = addDays(thisMonday, -7 * i);
    // Påfylls DIREKT när veckan blir klar (söndagens handling) ⇒ söndagens månad.
    const payoutDay = addDays(monday, 6);
    if (!payoutDay.startsWith(monthKey) || !completeWeek(monday)) continue;
    const r = rewardFor(plan, streakAt(monday));
    monthBonus.scans += r.scans;
    monthBonus.grades += r.grades;
  }

  return {
    today,
    week,
    todayDone,
    daysThisWeek,
    dayStreak,
    weekStreak,
    weekStillPossible,
    nextReward,
    lastWeekReward,
    monthBonus,
  };
}

/** Vad klienten får veta direkt efter dagens FÖRSTA handling (svarshuvudet x-scoutr-streak). */
export interface StreakEvent {
  dayStreak: number;
  weekStreak: number;
  daysThisWeek: number;
  /** Måndag→söndag, true = gjord. */
  week: boolean[];
  /** Index (0–6) för idag i `week`. */
  todayIndex: number;
  /** Veckan blev klar just nu ⇒ påfyllningen visas. */
  weekCompleted: boolean;
  reward: StreakReward | null;
  nextReward: StreakReward;
}

export function streakEvent(state: StreakState): StreakEvent {
  const weekCompleted = state.daysThisWeek === 7;
  return {
    dayStreak: state.dayStreak,
    weekStreak: state.weekStreak,
    daysThisWeek: state.daysThisWeek,
    week: state.week.map((d) => d.done),
    todayIndex: state.week.findIndex((d) => d.isToday),
    weekCompleted,
    reward: weekCompleted ? state.nextReward : null,
    nextReward: state.nextReward,
  };
}

export const STREAK_HEADER = "x-scoutr-streak";
