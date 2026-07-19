/**
 * Tester för invite-belöningen (#10): bonusförlängning + Pro-grindarna.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/mailer", () => ({ sendMail: vi.fn() }));

import { extendBonus } from "@/services/invites";
import { isPro, proUserWhere } from "@/lib/plan";

describe("extendBonus", () => {
  const now = new Date("2026-07-19T12:00:00Z");

  it("ingen bonus → en månad från nu", () => {
    expect(extendBonus(null, now).toISOString()).toBe("2026-08-19T12:00:00.000Z");
  });

  it("aktiv bonus → staplas från dess slutdatum, inte från nu", () => {
    const current = new Date("2026-08-01T00:00:00Z");
    expect(extendBonus(current, now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("utgången bonus → räknas från nu (död tid ger inget)", () => {
    const expired = new Date("2026-06-01T00:00:00Z");
    expect(extendBonus(expired, now).toISOString()).toBe("2026-08-19T12:00:00.000Z");
  });
});

describe("isPro med referral-bonus", () => {
  const base = { planTier: "FREE", role: "USER" } as const;

  it("aktiv bonus = Pro; utgången/ingen = inte Pro", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isPro({ ...base, bonusProUntil: future })).toBe(true);
    expect(isPro({ ...base, bonusProUntil: past })).toBe(false);
    expect(isPro({ ...base, bonusProUntil: null })).toBe(false);
    expect(isPro(base)).toBe(false);
  });

  it("PREMIUM och admin är Pro oavsett bonus (regression)", () => {
    expect(isPro({ planTier: "PREMIUM", role: "USER" })).toBe(true);
    expect(isPro({ planTier: "FREE", role: "ADMIN" })).toBe(true);
  });

  it("proUserWhere innehåller bonus-grenen med FÄRSK tidsstämpel", () => {
    const w1 = proUserWhere();
    const branches = (w1.OR ?? []) as Record<string, unknown>[];
    const bonus = branches.find((b) => "bonusProUntil" in b) as
      | { bonusProUntil: { gt: Date } }
      | undefined;
    expect(bonus).toBeDefined();
    expect(Math.abs(bonus!.bonusProUntil.gt.getTime() - Date.now())).toBeLessThan(5000);
  });
});
