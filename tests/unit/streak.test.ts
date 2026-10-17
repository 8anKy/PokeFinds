import { describe, expect, it } from "vitest";
import { addDays, computeStreak, rewardFor, stockholmDayKey, streakEvent, weekStart } from "@/lib/streak";

// 2026-10-12 är en måndag.
const MON = "2026-10-12";
const week = (monday: string, n = 7) => Array.from({ length: n }, (_, i) => addDays(monday, i));

describe("dagnyckeln följer svensk tid, aldrig klientens", () => {
  it("23:30 UTC söndag är redan måndag i Stockholm (sommartid)", () => {
    expect(stockholmDayKey(new Date("2026-10-11T22:30:00Z"))).toBe("2026-10-12");
  });
  it("vintertid: 23:30 UTC = 00:30 nästa dag", () => {
    expect(stockholmDayKey(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
  });
  it("veckan börjar på måndag", () => {
    expect(weekStart("2026-10-18")).toBe(MON); // söndag
    expect(weekStart(MON)).toBe(MON);
  });
});

describe("computeStreak", () => {
  it("en dag räknas bara när den har en handling", () => {
    const s = computeStreak([MON, addDays(MON, 1)], "FREE", addDays(MON, 2), "2026-10");
    expect(s.daysThisWeek).toBe(2);
    expect(s.todayDone).toBe(false);
    expect(s.dayStreak).toBe(2); // igår + i förrgår, idag kan fortfarande räddas
    expect(s.weekStillPossible).toBe(true);
  });

  it("en missad dag gör veckan omöjlig men bryter inte veckoserien", () => {
    const days = [...week(addDays(MON, -7)), MON, addDays(MON, 2)];
    const s = computeStreak(days, "FREE", addDays(MON, 2), "2026-10");
    expect(s.weekStillPossible).toBe(false);
    expect(s.weekStreak).toBe(2);
    expect(s.dayStreak).toBe(1);
  });

  it("en hel vecka utan handling nollar veckoserien", () => {
    const days = [...week(addDays(MON, -14))];
    const s = computeStreak(days, "FREE", MON, "2026-10");
    expect(s.weekStreak).toBe(0);
  });

  it("klar vecka ger påfyllning i söndagens månad, även när den blir klar idag", () => {
    const s = computeStreak(week(MON), "FREE", addDays(MON, 6), "2026-10");
    expect(s.daysThisWeek).toBe(7);
    expect(s.monthBonus).toEqual({ scans: 10, grades: 1 });
    expect(streakEvent(s).weekCompleted).toBe(true);
    expect(streakEvent(s).reward).toEqual({ scans: 10, grades: 1 });
  });

  it("påfyllningen hör till månaden veckan blev klar i", () => {
    // Vecka 2026-09-28 → söndag 10-04 (oktober). Vecka 09-21 → söndag 09-27 (september).
    const days = [...week("2026-09-21"), ...week("2026-09-28")];
    const s = computeStreak(days, "FREE", "2026-10-05", "2026-10");
    expect(s.monthBonus).toEqual({ scans: 10, grades: 1 });
    expect(s.lastWeekReward).toEqual({ scans: 10, grades: 1 });
  });

  it("från vecka 4 i rad ×1,5 (uppåt)", () => {
    expect(rewardFor("FREE", 3)).toEqual({ scans: 10, grades: 1 });
    expect(rewardFor("FREE", 4)).toEqual({ scans: 15, grades: 2 });
    expect(rewardFor("PREMIUM", 4)).toEqual({ scans: 0, grades: 3 });
    // tre aktiva veckor före ⇒ denna blir vecka 4
    const days = [MON, addDays(MON, -7), addDays(MON, -14), addDays(MON, -21)];
    const s = computeStreak(days, "FREE", MON, "2026-10");
    expect(s.weekStreak).toBe(4);
    expect(s.nextReward).toEqual({ scans: 15, grades: 2 });
  });

  it("Pro får graderingar, inga skanningar", () => {
    const s = computeStreak(week(MON), "PREMIUM", addDays(MON, 6), "2026-10");
    expect(s.monthBonus).toEqual({ scans: 0, grades: 2 });
  });

  it("dubbletter och ordning spelar ingen roll", () => {
    const s = computeStreak([MON, MON, addDays(MON, 1), MON], "FREE", addDays(MON, 1), "2026-10");
    expect(s.daysThisWeek).toBe(2);
    expect(s.dayStreak).toBe(2);
  });
});
