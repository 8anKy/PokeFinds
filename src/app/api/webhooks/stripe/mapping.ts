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

/**
 * WEBBENS 12-MÅNADERSBINDNING (2026-10-19). Stripe har ingen bindningstid, så vi
 * upprätthåller den själva: prenumerationen bär `metadata.plan = "commit"`, och
 * bindningen löper 12 månader från FÖRSTA BETALNINGEN (provperiodens slut, annars
 * starten). Kunden säger upp precis som vanligt i Stripes kundportal; webhooken
 * flyttar då slutet från periodens slut till bindningstidens slut (`cancel_at`) —
 * samma beteende som Apples 12-månadersåtagande ("säg upp när du vill, du betalar
 * året ut"). Efter bindningstiden löper planen vidare månadsvis tills den sägs upp.
 */
export const COMMIT_PLAN = "commit";

/** start + N månader, UTC. 29 feb → 28 feb, som Stripes egen faktureringsankare. */
export function addMonthsUtc(at: Date, months: number): Date {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds())
  );
}

export function commitmentEndFor(
  firstChargeSeconds: number | null | undefined,
  months: number
): Date | null {
  if (typeof firstChargeSeconds !== "number" || firstChargeSeconds <= 0) return null;
  return addMonthsUtc(new Date(firstChargeSeconds * 1000), months);
}

/**
 * Ska uppsägningen flyttas? Returnerar `cancel_at` i sekunder, eller null = låt den vara.
 *
 * ⛔ Under PROVPERIODEN flyttas ingenting: "avsluta före dag 14 så kostar det
 * ingenting" är löftet i arket, villkoren och påminnelsen. Och den sista perioden
 * i bindningen får avslutas vid sitt naturliga slut — då är bindningen redan uppfylld.
 */
export function commitmentCancelAt(input: {
  status: string;
  cancelAtPeriodEnd: boolean;
  cancelAtSeconds: number | null;
  commitmentEndsAt: Date | null;
  periodEndSeconds: number | null;
}): number | null {
  if (!input.commitmentEndsAt) return null;
  if (input.status !== "active" && input.status !== "past_due") return null;
  const end = Math.floor(input.commitmentEndsAt.getTime() / 1000);
  const wantsOut =
    input.cancelAtPeriodEnd || (input.cancelAtSeconds != null && input.cancelAtSeconds < end - 60);
  if (!wantsOut) return null;
  if (input.periodEndSeconds != null && input.periodEndSeconds >= end - 3600) return null;
  if (input.cancelAtSeconds === end) return null;
  return end;
}
