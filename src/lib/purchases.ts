import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  STOREKIT_VERSION,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import { pickStorePlans, type StorePlanOption } from "@/lib/store-plans";
import type { ProPlanChoice } from "@/lib/pro-plans";

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

/**
 * Appen körs i App Store-/Play-skalet men plattformens RevenueCat-nyckel saknas
 * (t.ex. Android innan `NEXT_PUBLIC_RC_ANDROID_KEY` finns i Railway).
 *
 * ⛔ Då får köpknappen ALDRIG falla tillbaka på Stripe. Både Apple och Google
 * förbjuder egen checkout för digitala varor inne i appen, och Play avvisar (eller
 * drar) bygget vid granskningen. Utan den här grinden visade `/priser` — som i appen
 * ÄR hela paywallen — Stripe-knappen så snart nyckeln fattades, eftersom
 * `purchasesAvailable()` då är false och webbgrenen tog över. Visa "kommer snart".
 */
export const storeShellWithoutPurchases = () => Capacitor.isNativePlatform() && !API_KEY;

export interface StorePlans {
  month: StorePlanOption | null;
  year: StorePlanOption | null;
}

/**
 * Butikens planer för arket (2026-10-19): 12 månader (Apples åtagande, annars
 * förbetald årsplan) och månadsvis — med BUTIKENS priser och provperiod.
 *
 * ⛔ Provperioden visas bara när Apple säger att kontot är berättigat (en
 * provperiod per Apple-ID och prenumerationsgrupp). Okänt ⇒ visa den INTE —
 * RevenueCats egen rekommendation: att lova gratisdagar som sedan inte ges är
 * vilseledande. Android: Google lägger bara in provperioden i `defaultOption`
 * när kontot är berättigat.
 */
export async function loadStorePlans(userId: string): Promise<StorePlans> {
  await ensureConfigured(userId);
  const offerings = await Purchases.getOfferings();
  const plans = pickStorePlans(offerings.current?.availablePackages ?? []);
  if (plans.year?.trialDays && Capacitor.getPlatform() === "ios") {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility({
      productIdentifiers: [plans.year.productId],
    }).catch(() => null);
    const status = eligibility?.[plans.year.productId]?.status;
    if (status !== INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) {
      plans.year = { ...plans.year, trialDays: null };
    }
  }
  return plans;
}

async function packageFor(choice: ProPlanChoice): Promise<PurchasesPackage | null> {
  const offerings = await Purchases.getOfferings();
  const pkgs = offerings.current?.availablePackages ?? [];
  const plans = pickStorePlans(pkgs);
  const id = (choice === "year" ? plans.year : plans.month)?.packageId;
  return pkgs.find((p) => p.identifier === id) ?? null;
}

/** Köp Pro på vald plan. Returnerar true om köpet gav premium-entitlement. */
export async function purchasePlan(userId: string, choice: ProPlanChoice): Promise<boolean> {
  await ensureConfigured(userId);
  const pkg = await packageFor(choice);
  if (!pkg) throw new Error("Ingen prenumeration tillgänglig just nu.");
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}

/** Månadsplanen — kvar för anropare som inte väljer plan. */
export async function purchasePremium(userId: string): Promise<boolean> {
  return purchasePlan(userId, "month");
}

/**
 * Butikens egen sida för prenumerationen (Apple: Prenumerationer i inställningarna,
 * Google: Play-prenumerationerna). null = butiken gav ingen länk (t.ex. inget köp).
 */
export async function storeManagementUrl(userId: string): Promise<string | null> {
  await ensureConfigured(userId);
  const { customerInfo } = await Purchases.getCustomerInfo();
  return customerInfo.managementURL ?? null;
}

/** Återställ tidigare köp (App Store-krav: knapp för "Restore purchases"). */
export async function restorePremium(userId: string): Promise<boolean> {
  await ensureConfigured(userId);
  const { customerInfo } = await Purchases.restorePurchases();
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}
