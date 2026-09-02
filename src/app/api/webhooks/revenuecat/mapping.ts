// RevenueCat-event → vilka användare ska få vilken plan.
// Egen modul (ej route.ts) eftersom Next bara tillåter HTTP-handlers som exports där.

export type Plan = "PREMIUM" | "FREE";

/** En plan-ändring som eventet innebär. Ett event kan röra FLERA användare. */
export interface PlanChange {
  userId: string;
  plan: Plan;
}

// RC anonyma id:n hör inte ihop med någon av våra användare.
const isOurUserId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && !v.startsWith("$RCAnonymousID");

/**
 * Vad ska planen bli av ETT event som rör EN användare?
 * null = ignorera (t.ex. CANCELLATION = "förnyas inte", men access finns kvar
 * tills EXPIRATION fyrar). Se RC:s webhook-docs.
 */
export function planForEvent(type: string): Plan | null {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "NON_RENEWING_PURCHASE":
    case "SUBSCRIPTION_EXTENDED":
      return "PREMIUM";
    case "EXPIRATION":
      return "FREE";
    default:
      return null;
  }
}

/** Plocka ut våra användar-id:n ur ett fält som RC skickar som array (eller ensamt). */
function userIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw.filter(isOurUserId);
}

/**
 * Alla plan-ändringar ett event innebär.
 *
 * ⛔ **TRANSFER SAKNAR `app_user_id` HELT.** RC:s egen fältdokumentation säger
 * att "Subscriber identity fields" inte gäller för TRANSFER — mottagare och
 * avsändare ligger i `transferred_to` / `transferred_from` i stället. Den gamla
 * koden läste bara `app_user_id`, fick `undefined` och svarade 200 UTAN att
 * skriva något.
 *
 * MÄTT I PRODUKTION 2026-08-09: ett sandbox-köp flyttade prenumerationen till
 * användaren som köpte ("Got their purchases transferred from cmqk2ya…",
 * 17:41 UTC). Ingen AuditLog-rad skrevs — kontot fick Pro först 17 MINUTER
 * senare, av en RENEWAL som råkade fyra (17:58 UTC). Det var hela orsaken till
 * "Pro aktiveras strax" och till att Pro dök upp långt efteråt.
 *
 * ⛔ DET HÄR TRÄFFAR APPLES GRANSKARE. Ett sandbox-Apple-ID som redan köpt appen
 * en gång ger en TRANSFER, inte en INITIAL_PURCHASE, när det köps på ett nytt
 * konto. Granskaren betalar och får ingenting.
 *
 * `transferred_to` får PREMIUM och `transferred_from` FREE. Avvägningen är
 * medvetet asymmetrisk: prenumerationen HAR flyttat, så avsändaren ska förlora
 * den. Det är ofarligt för admins och för referral-/Stripe-Pro — de bor i egna
 * kolumner (`role`, `bonusProUntil`, `stripeProUntil`) och `isPro()` väger in
 * dem oberoende av `planTier`.
 */
export function planChangesForEvent(event: unknown): PlanChange[] {
  const e = (event ?? {}) as Record<string, unknown>;
  const type = String(e.type);

  if (type === "TRANSFER") {
    const changes: PlanChange[] = [];
    for (const userId of userIds(e.transferred_to)) changes.push({ userId, plan: "PREMIUM" });
    for (const userId of userIds(e.transferred_from)) {
      // ⛔ Samma id i båda listorna → mottagaren vinner. Att skriva FREE efter
      // PREMIUM hade tagit bort Pro från den som just fick det.
      if (changes.some((c) => c.userId === userId)) continue;
      changes.push({ userId, plan: "FREE" });
    }
    return changes;
  }

  const plan = planForEvent(type);
  if (!plan) return [];
  return isOurUserId(e.app_user_id) ? [{ userId: e.app_user_id, plan }] : [];
}

/**
 * PRENUMERATIONSSTATUS — det eventet säger om FÖRNYELSEN, skilt från planen.
 *
 * `planForEvent` ovan svarar bara på "har kontot Pro?" och ignorerar därför
 * CANCELLATION med flit (access kvar till EXPIRATION). Men adminen behöver
 * också veta om prenumerationen FÖRNYAS: en kund som sagt upp syns annars som
 * betalande ända tills perioden tar slut, och "vi har 8 prenumeranter" är då
 * en lögn om nästa månad. Därför en egen dom per event:
 *   true  = förnyas automatiskt (köp, förnyelse, ångrad uppsägning, byte)
 *   false = förnyas INTE (uppsagd, utgången, engångsköp)
 *   null  = eventet säger inget om förnyelsen (BILLING_ISSUE, TEST, alias …)
 * null skrivs ALDRIG över ett känt värde — se route.ts.
 */
export function willRenewForEvent(type: string): boolean | null {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
      return true;
    case "CANCELLATION":
    case "EXPIRATION":
    case "NON_RENEWING_PURCHASE":
      return false;
    default:
      return null;
  }
}

export interface SubscriptionState {
  userId: string;
  willRenew: boolean | null;
  /** RC:s `expiration_at_ms` → Date; null när eventet saknar det. */
  expiresAt: Date | null;
  /** "SANDBOX" | "PRODUCTION" | null. Ett sandbox-köp är en testare, inte en kund. */
  environment: string | null;
}

function msToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

/**
 * Status-ändringar per användare för ETT event. Speglar `planChangesForEvent`:
 * TRANSFER läser `transferred_to`/`transferred_from` (mottagaren ärver
 * prenumerationen och förnyas; avsändaren har ingen kvar), allt annat
 * `app_user_id`. Returnerar tomt för anonyma id:n och för eventtyper som inte
 * säger något om förnyelsen — då finns inget att skriva.
 */
export function subscriptionStatesForEvent(event: unknown): SubscriptionState[] {
  const e = (event ?? {}) as Record<string, unknown>;
  const type = String(e.type);
  const expiresAt = msToDate(e.expiration_at_ms);
  const environment = typeof e.environment === "string" ? e.environment : null;

  if (type === "TRANSFER") {
    const states: SubscriptionState[] = [];
    for (const userId of userIds(e.transferred_to)) {
      states.push({ userId, willRenew: true, expiresAt, environment });
    }
    for (const userId of userIds(e.transferred_from)) {
      if (states.some((s) => s.userId === userId)) continue;
      states.push({ userId, willRenew: false, expiresAt: null, environment });
    }
    return states;
  }

  const willRenew = willRenewForEvent(type);
  if (willRenew === null) return [];
  return isOurUserId(e.app_user_id)
    ? [{ userId: e.app_user_id, willRenew, expiresAt, environment }]
    : [];
}
