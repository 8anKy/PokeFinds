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

// ponytail: TEMP diagnostik — ta bort när Safari-redirect-buggen är löst.
// Visar plattform + offeringens paket (id, typ, web-checkout, produkt-id) så vi
// ser exakt vad som händer på enheten istället för att gissa.
export async function describeOfferings(userId: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return `native=false platform=${Capacitor.getPlatform()}`;
  if (!API_KEY) return `native=true men API_KEY SAKNAS (platform=${Capacitor.getPlatform()})`;
  await ensureConfigured(userId);
  const o = await Purchases.getOfferings();
  const cur = o.current;
  const pkgs = (cur?.availablePackages ?? []).map(
    (p) => `${p.identifier}/${p.packageType}/web=${p.webCheckoutUrl ? "JA" : "nej"}/${p.product.identifier}`
  );
  // Nyckel-PREFIX (ej hemligheten): appl_ = rätt App Store-nyckel → native köp.
  // rcb_/strp_/sk_ = Web Billing → purchasePackage öppnar Safari. Detta är testet.
  const keyPrefix = API_KEY ? API_KEY.slice(0, 5) : "SAKNAS";
  return `key=${keyPrefix} platform=${Capacitor.getPlatform()} current=${cur?.identifier ?? "INGEN"} antal=${pkgs.length}\n${pkgs.join("\n")}`;
}

/** Köp Premium. Returnerar true om köpet gav premium-entitlement. */
export async function purchasePremium(userId: string): Promise<boolean> {
  await ensureConfigured(userId);
  const offerings = await Purchases.getOfferings();
  const offering = offerings.current;
  const all = offering?.availablePackages ?? [];
  // Ett paket med webCheckoutUrl är ett RC Web Checkout-paket → purchasePackage
  // öppnar det i Safari. Köp BARA App Store-paket (webCheckoutUrl == null), och
  // föredra månadspaketet (planen = 49 kr/mån). availablePackages[0] var fel:
  // ordningsberoende, kunde bli webb-paketet → Safari.
  const native = all.filter((p) => p.webCheckoutUrl == null);
  if (native.length === 0) {
    throw new Error(
      `Inget App Store-paket i offeringen (${all.length} paket, alla web checkout). ` +
        `Lägg App Store-produkten i RevenueCat-offeringen.`
    );
  }
  const pkg =
    offering?.monthly && offering.monthly.webCheckoutUrl == null
      ? offering.monthly
      : native.find((p) => p.packageType === "MONTHLY") ?? native[0];
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}

/** Återställ tidigare köp (App Store-krav: knapp för "Restore purchases"). */
export async function restorePremium(userId: string): Promise<boolean> {
  await ensureConfigured(userId);
  const { customerInfo } = await Purchases.restorePurchases();
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}
