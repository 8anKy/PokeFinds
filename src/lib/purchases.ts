import { Capacitor } from "@capacitor/core";
import { Purchases, LOG_LEVEL, STOREKIT_VERSION } from "@revenuecat/purchases-capacitor";

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
  await Purchases.configure({
    apiKey: API_KEY!,
    appUserID: userId,
    /**
     * ⛔ STOREKIT 2 PINNAS MED FLIT — lämna den inte på DEFAULT.
     *
     * StoreKit 1 validerar köpet mot appens KVITTOFIL på enheten. Filen skrivs
     * om av systemet efter köpet, och hinner RevenueCat posta den innan dess
     * saknas den just köpta produkten i kvittot. Resultatet är felet
     * "The receipt is not valid. The purchased product was missing in the
     * receipt. This is typically due to a bug in StoreKit." — MÄTT I FÄLT
     * 2026-08-09: första trycket på "Uppgradera till Pro" gav exakt det, andra
     * trycket gick igenom (då var filen uppdaterad).
     *
     * StoreKit 2 har ingen kvittofil alls — varje transaktion bär sitt eget
     * signerade JWS — så HELA felklassen försvinner. Det är RevenueCats egen
     * rekommenderade lösning, inte en gissning.
     *
     * FÖRUTSÄTTNING (verifierad 2026-08-09): In-App Purchase Key måste ligga i
     * RevenueCat-dashboarden, annars kan SK2 inte registrera transaktioner och
     * kunden får INTE det hen betalat för. Vår är `9WS85U9QMF.p8`, status
     * "Valid credentials". ⛔ Roteras eller tas den bort måste den här raden
     * tillbaka till STOREKIT_1 — annars går köpen sönder tyst.
     *
     * iOS 15 (vår deployment target) saknar SK2; RevenueCat faller då tillbaka
     * på SK1 av sig själv. Inget att hantera här.
     *
     * ⛔ KRÄVER INGET NYTT NATIVE-BYGGE. Native-plugin:et läser värdet ur
     * anropet i runtime (`call.getString("storeKitVersion")`,
     * PurchasesPlugin.swift), och PurchasesHybridCommon 18.21.0 ligger redan i
     * bygge 38. Konfigurationen reser över Capacitor-bryggan från JS:en som
     * Railway serverar — samma väg som resten av appens kod.
     */
    storeKitVersion: STOREKIT_VERSION.STOREKIT_2,
  });
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
