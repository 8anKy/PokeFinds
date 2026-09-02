import { proSource, type ProUserShape } from "./plan";

/**
 * FÖRNYAS PRENUMERATIONEN? — adminens tredje fråga efter "har Pro?" och "varför?".
 *
 * ⛔ TRE UTFALL, ALDRIG TVÅ (samma regel som kostnadsvyn): "yes" och "no" är
 * uppmätta svar ur leverantörens webhook; "unknown" betyder att inget event
 * skrivit fältet sedan kolumnerna kom (2026-09-02) — det är inte ett nej.
 * "none" = ingen prenumeration att förnya (bonus, roll, eller inte Pro alls).
 *
 * Källan avgör vilket fält som gäller, i samma ordning som `proSource()`:
 * Stripe läser `cancel_at_period_end` (inverterat), appen RevenueCats
 * `willRenew`. En kund kan ha båda — då är det den som DEBITERAS som räknas.
 */
export type RenewalStatus = "yes" | "no" | "unknown" | "none";

export interface RenewalShape extends ProUserShape {
  stripeCustomerId?: string | null;
  stripeCancelAtPeriodEnd: boolean | null;
  rcWillRenew: boolean | null;
}

export function renewalStatus(user: RenewalShape): RenewalStatus {
  switch (proSource(user)) {
    case "stripe":
      if (user.stripeCancelAtPeriodEnd === null) return "unknown";
      return user.stripeCancelAtPeriodEnd ? "no" : "yes";
    case "store":
      if (user.rcWillRenew === null) return "unknown";
      return user.rcWillRenew ? "yes" : "no";
    default:
      return "none";
  }
}

export const RENEWAL_LABELS: Record<RenewalStatus, { label: string; hint: string }> = {
  yes: { label: "Förnyas", hint: "Prenumerationen förnyas automatiskt enligt leverantörens senaste event." },
  no: {
    label: "Uppsagd",
    hint: "Kunden har stängt av auto-förnyelse. Pro gäller till periodens slut, sedan faller den bort.",
  },
  unknown: {
    label: "Okänt",
    hint: "Inget webhook-event har skrivit förnyelsestatus sedan kolumnen kom (2026-09-02). Läker vid nästa event.",
  },
  none: { label: "–", hint: "Ingen prenumeration att förnya (bonus, roll eller inte Pro)." },
};
