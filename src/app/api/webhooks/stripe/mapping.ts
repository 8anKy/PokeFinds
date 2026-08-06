/**
 * Stripe prenumerationsstatus → hur länge Pro gäller. REN funktion i egen modul,
 * precis som revenuecat/mapping.ts: Next tillåter bara HTTP-handlers som exports
 * i route.ts, och den här domen är det enda som avgör om en betalande kund
 * behåller sina larm — den ska gå att testa utan databas och utan Stripe.
 */

/**
 * ⛔ Stripe skriver ALDRIG `planTier`. Det fältet ägs av RevenueCat-webhooken,
 * vars EXPIRATION sätter FREE ovillkorligt — 2026-07-08 tystade exakt det alla
 * restock-larm i fyra dygn. En utgången sandbox-prenumeration på Apple-sidan får
 * inte kunna säga upp en betalande webbkund. Webben får därför en EGEN kolumn
 * (`stripeProUntil`), som blir en fjärde gren i isPro()/proUserWhere() — samma
 * mönster som referral-bonusens `bonusProUntil`.
 */

/**
 * Nåd efter periodens slut.
 *
 * Avvägningen är inte symmetrisk. För kort → en betalande kund tappar sina larm
 * för att en webhook dröjde (samma tysta fel som 07-08). För lång → en avhoppare
 * behåller Pro några dygn extra, vilket kostar oss ingenting mätbart. Därför
 * tilltaget: tre dygn absorberar både webhook-avbrott och Stripes kortförnyelse-
 * försök.
 */
export const GRACE_DAYS = 3;

/**
 * Status som ger tillgång.
 * - `active` / `trialing` — uppenbart.
 * - `past_due` — förnyelsen misslyckades och Stripe gör om försöket. Perioden
 *   kunden REDAN betalat för löper ändå ut vid `current_period_end`, så nåden
 *   ovan är hela extratiden de får. Att kasta ut dem direkt vid ett nekat kort
 *   vore att straffa ett utgånget kort som oftast förnyas inom ett dygn.
 * Allt annat (`canceled`, `unpaid`, `incomplete`, `incomplete_expired`,
 * `paused`) ger ingen tillgång.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function statusGrantsPro(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * Datumet `User.stripeProUntil` ska sättas till, eller null = ingen Pro via
 * Stripe. `periodEndSeconds` kommer från `subscriptionPeriodEnd()` — läs den
 * kommentaren innan du rör fältet.
 *
 * Absolut datum, inte en boolean, av två skäl: det är självläkande (missas
 * uppsägningen löper Pro ut ändå) och det gör funktionen idempotent — samma
 * event levererat två gånger, eller i fel ordning, ger samma svar.
 */
export function proUntilForSubscription(
  status: string,
  periodEndSeconds: number | null | undefined
): Date | null {
  if (!statusGrantsPro(status)) return null;
  if (typeof periodEndSeconds !== "number" || periodEndSeconds <= 0) return null;
  return new Date(periodEndSeconds * 1000 + GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Event vi bryr oss om. Alla leder till SAMMA sak: hämta prenumerationen färsk
 * från Stripe och skriv om datumet.
 *
 * ⛔ Vi litar inte på objektet i eventet. Webhooks kan levereras i FEL ORDNING
 * (Stripe garanterar det inte), och ett försenat `updated` med gammal status
 * hade då sagt upp en aktiv kund. En färsk hämtning är alltid nuläget, så
 * ordningen slutar spela roll — en extra API-förfrågan per event är billigt
 * jämfört med att fel-avsluta någons prenumeration.
 */
export const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
