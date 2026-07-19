import { describe, expect, it } from "vitest";
import { proUserWhere, effectivePlanTier, isPro } from "@/lib/plan";

describe("isPro", () => {
  it("betalande prenumerant är Pro", () => {
    expect(isPro({ planTier: "PREMIUM", role: "USER" })).toBe(true);
  });

  it("gratisanvändare är inte Pro", () => {
    expect(isPro({ planTier: "FREE", role: "USER" })).toBe(false);
  });

  it("moderator UTAN prenumeration är inte Pro (bara admin/ägare)", () => {
    expect(isPro({ planTier: "FREE", role: "MODERATOR" })).toBe(false);
  });

  // Regression 2026-07-08: en RevenueCat EXPIRATION satte ägarens planTier till
  // FREE → alla restock-larm dog tyst i fyra dygn (ingen Pro-mottagare kvar).
  // Rollen kan inte gå ut, så ägaren/admin får sina larm oavsett prenumeration.
  it("admin och superadmin är Pro även med planTier=FREE", () => {
    expect(isPro({ planTier: "FREE", role: "ADMIN" })).toBe(true);
    expect(isPro({ planTier: "FREE", role: "SUPERADMIN" })).toBe(true);
  });
});

describe("effectivePlanTier", () => {
  it("ger PREMIUM-kvoter till admins, FREE till vanliga gratisanvändare", () => {
    expect(effectivePlanTier({ planTier: "FREE", role: "SUPERADMIN" })).toBe("PREMIUM");
    expect(effectivePlanTier({ planTier: "FREE", role: "USER" })).toBe("FREE");
    expect(effectivePlanTier({ planTier: "PREMIUM", role: "USER" })).toBe("PREMIUM");
  });
});

describe("proUserWhere", () => {
  // Prisma-filtret MÅSTE spegla isPro() — annars kan larmfrågorna missa mottagare
  // som appen i övrigt behandlar som Pro (exakt buggen ovan). Sedan #10 ingår
  // referral-bonusen (bonusProUntil > nu) som tredje gren.
  it("matchar samma användare som isPro()", () => {
    const or = proUserWhere().OR;
    expect(or?.slice(0, 2)).toEqual([
      { planTier: "PREMIUM" },
      { role: { in: ["ADMIN", "SUPERADMIN"] } },
    ]);
    const bonus = or?.[2] as { bonusProUntil: { gt: Date } };
    expect(bonus.bonusProUntil.gt).toBeInstanceOf(Date);
  });
});
