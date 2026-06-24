import { Capacitor } from "@capacitor/core";
import { Purchases, LOG_LEVEL } from "@revenuecat/purchases-capacitor";

// Plattforms-specifika RC API-nycklar (publika, ok i klienten). Sätt vid bygge.
const API_KEY = Capacitor.getPlatform() === "ios"
  ? process.env.NEXT_PUBLIC_RC_IOS_KEY
  : process.env.NEXT_PUBLIC_RC_ANDROID_KEY;

const ENTITLEMENT = "premium"; // entitlement-id i RevenueCat-dashboarden

let configuredFor: string | null = null;

async function ensureConfigured(userId: string) {
  if (configuredFor === userId) return;
  await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
  // appUserID = vår user-id → kommer tillbaka som app_user_id i webhooken.
  await Purchases.configure({ apiKey: API_KEY!, appUserID: userId });
  configuredFor = userId;
}

export const purchasesAvailable = () => Capacitor.isNativePlatform() && !!API_KEY;

/** Köp Premium. Returnerar true om köpet gav premium-entitlement. */
export async function purchasePremium(userId: string): Promise<boolean> {
  await ensureConfigured(userId);
  const offerings = await Purchases.getOfferings();
  const offering = offerings.current;
  // Planen är 49 kr/MÅNAD → välj månadspaketet deterministiskt.
  const pkg = offering?.monthly ?? offering?.availablePackages[0];
  if (!pkg) throw new Error("Ingen prenumeration tillgänglig just nu.");
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}

/** Återställ tidigare köp (App Store-krav: knapp för "Restore purchases"). */
export async function restorePremium(userId: string): Promise<boolean> {
  await ensureConfigured(userId);
  const { customerInfo } = await Purchases.restorePurchases();
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}
