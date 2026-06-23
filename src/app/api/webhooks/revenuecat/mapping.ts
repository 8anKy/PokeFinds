// RevenueCat-event → vad planTier ska bli. null = ignorera (t.ex. CANCELLATION =
// "förnyas inte" men access finns kvar till EXPIRATION fyrar). Se RC webhook-docs.
// Egen modul (ej route.ts) eftersom Next bara tillåter HTTP-handlers som exports där.
export function planForEvent(type: string): "PREMIUM" | "FREE" | null {
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
