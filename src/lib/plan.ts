import type { PlanTier, Prisma, Role } from "@prisma/client";

/**
 * Vem som har Pro-förmåner.
 *
 * Pro = betalande prenumerant (planTier=PREMIUM) ELLER admin/ägare. Rollen ingår
 * med FLIT: planTier ägs av RevenueCat-webhooken, som sätter FREE på EXPIRATION.
 * En utgången (t.ex. sandbox-)prenumeration på ägarkontot nollade därmed
 * planTier och TYSTADE ALLA restock-larm i fyra dygn (2026-07-08) — det fanns
 * ingen annan Pro-mottagare kvar. Rollen kan inte gå ut, så den bryter kopplingen
 * mellan "prenumerationens status" och "ägaren får sina larm".
 */
const PRO_ROLES: Role[] = ["ADMIN", "SUPERADMIN"];

export function isPro(user: { planTier: PlanTier; role: Role }): boolean {
  return user.planTier === "PREMIUM" || PRO_ROLES.includes(user.role);
}

/** Planen som kvoter/gränser ska räknas mot (admins får Pro-gränserna). */
export function effectivePlanTier(user: { planTier: PlanTier; role: Role }): PlanTier {
  return isPro(user) ? "PREMIUM" : "FREE";
}

/**
 * Prisma-filter för "användaren har Pro" — spegelbilden av isPro() i DB-frågor.
 * Använd i ALLA mottagarfrågor för larm; ett bart `planTier: "PREMIUM"` missar admins.
 */
export const PRO_USER_WHERE: Prisma.UserWhereInput = {
  OR: [{ planTier: "PREMIUM" }, { role: { in: PRO_ROLES } }],
};
