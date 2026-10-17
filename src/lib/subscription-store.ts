/**
 * VILKEN BUTIK EN APP-PRENUMERATION KÖPTES I (2026-10-17, ägaren ville se intäkten per butik).
 *
 * Ingen ny kolumn: RevenueCat-webhooken loggar `store` ("APP_STORE" / "PLAY_STORE" …) i varje
 * `user.plan.revenuecat`-rad sedan 2026-08-30, och adminöversikten hämtar de raderna ändå.
 * ⛔ Senaste raden MED en butik vinner — en rad utan (före loggningen) är "vet inte", inte en butik.
 * ⛔ Okänd butik gissas ALDRIG till App Store, även om det är troligast: köp före 08-30 och
 * RevenueCat-gåvor blir en egen post.
 */
export type PayingChannel = "app_store" | "play_store" | "store_unknown" | "stripe";

export const CHANNEL_LABELS: Record<PayingChannel, string> = {
  app_store: "App Store",
  play_store: "Google Play",
  store_unknown: "App-butik okänd",
  stripe: "Stripe (webb)",
};

export function storeChannel(store: string | null | undefined): PayingChannel {
  switch (store) {
    case "APP_STORE":
    case "MAC_APP_STORE":
      return "app_store";
    case "PLAY_STORE":
      return "play_store";
    default:
      return "store_unknown";
  }
}

/** userId → senast loggade butik ur webhook-raderna (ordningen på raderna spelar ingen roll). */
export function latestStoreByUser(
  rows: { userId: string | null; action: string; createdAt: Date; metadata: unknown }[]
): Map<string, string> {
  const latest = new Map<string, { at: number; store: string }>();
  for (const r of rows) {
    if (!r.userId || r.action !== "user.plan.revenuecat") continue;
    const store = (r.metadata as { store?: unknown } | null)?.store;
    if (typeof store !== "string" || !store) continue;
    const at = r.createdAt.getTime();
    const cur = latest.get(r.userId);
    if (!cur || at > cur.at) latest.set(r.userId, { at, store });
  }
  return new Map([...latest].map(([id, v]) => [id, v.store]));
}
