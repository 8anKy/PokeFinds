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

/** Formen isPro behöver. bonusProUntil = referral-Pro (#10), t.o.m.-datum. */
export interface ProUserShape {
  planTier: PlanTier;
  role: Role;
  /** Date från Prisma, ISO-sträng från JWT/cache — båda tolkas. */
  bonusProUntil?: Date | string | null;
}

export function isPro(user: ProUserShape): boolean {
  if (user.planTier === "PREMIUM" || PRO_ROLES.includes(user.role)) return true;
  const b = user.bonusProUntil;
  return b != null && new Date(b).getTime() > Date.now();
}

/** Planen som kvoter/gränser ska räknas mot (admins får Pro-gränserna). */
export function effectivePlanTier(user: ProUserShape): PlanTier {
  return isPro(user) ? "PREMIUM" : "FREE";
}

/**
 * Prisma-filter för "användaren har Pro" — spegelbilden av isPro() i DB-frågor.
 * Använd i ALLA mottagarfrågor för larm; ett bart `planTier: "PREMIUM"` missar
 * admins OCH referral-Pro. FUNKTION (inte const) med flit: bonusjämförelsen
 * behöver "nu" vid ANROPET — en modul-konstant hade fryst tidsstämpeln vid
 * processtart och sakta släppt in utgångna bonusar.
 */
export function proUserWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      { planTier: "PREMIUM" },
      { role: { in: PRO_ROLES } },
      { bonusProUntil: { gt: new Date() } },
    ],
  };
}
