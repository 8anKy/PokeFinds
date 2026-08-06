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
  /**
   * Stripe-prenumeration (webben) t.o.m. detta datum. FJÄRDE oberoende källan,
   * inte en variant av planTier: RevenueCat-webhooken skriver planTier=FREE på
   * EXPIRATION, så ett Apple-abonnemang som löper ut hade annars stängt av en
   * kund som betalar oss via kort. Skrivs av stripe-webhooken.
   */
  stripeProUntil?: Date | string | null;
}

/** Datum i framtiden? Tål både Date (Prisma) och ISO-sträng (JWT/cache). */
function activeUntil(value: Date | string | null | undefined): boolean {
  return value != null && new Date(value).getTime() > Date.now();
}

export function isPro(user: ProUserShape): boolean {
  if (user.planTier === "PREMIUM" || PRO_ROLES.includes(user.role)) return true;
  return activeUntil(user.bonusProUntil) || activeUntil(user.stripeProUntil);
}

/** Varifrån Pro kommer. `null` = användaren har inte Pro. */
export type ProSource = "stripe" | "store" | "bonus" | "role" | null;

/**
 * VARFÖR användaren har Pro — avgör vad gränssnittet får lova om uppsägning.
 *
 * ⛔ Betalkällan går FÖRE gratisförmånerna. Den som faktiskt debiteras någonstans
 * måste få veta VAR, annars står det "inget att säga upp" för någon som betalar
 * varje månad. En superadmin som ockå köpt i appen ska alltså se app-texten, inte
 * roll-texten.
 *
 * ⛔ "store" kan ALDRIG sägas upp av oss: den prenumerationen ägs av Apple/Google
 * och vi har ingen API-väg till den. Erbjud aldrig en avbryt-knapp för den — ett
 * löfte som inte går att hålla är sämre än en hänvisning som är sann.
 */
export function proSource(
  user: ProUserShape & { stripeCustomerId?: string | null }
): ProSource {
  if (activeUntil(user.stripeProUntil)) return "stripe";
  if (user.planTier === "PREMIUM") return "store";
  if (activeUntil(user.bonusProUntil)) return "bonus";
  if (PRO_ROLES.includes(user.role)) return "role";
  return null;
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
      // Webbprenumeranter. Glöms den här grenen får en betalande Stripe-kund
      // Pro i gränssnittet men INGA larm — larmens mottagarfrågor går enbart
      // via det här filtret, och felet syns först när mejlen uteblir.
      { stripeProUntil: { gt: new Date() } },
    ],
  };
}
