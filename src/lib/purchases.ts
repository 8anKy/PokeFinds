import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PRORATION_MODE,
  STOREKIT_VERSION,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import { currentPlanKind, pickStorePlans, type StorePlanOption } from "@/lib/store-plans";
import type { ProPlanChoice } from "@/lib/pro-plans";

// Plattforms-specifika RC API-nycklar (publika, ok i klienten). Sätt vid bygge.
const API_KEY = Capacitor.getPlatform() === "ios"
  ? process.env.NEXT_PUBLIC_RC_IOS_KEY
  : process.env.NEXT_PUBLIC_RC_ANDROID_KEY;

const ENTITLEMENT = "premium"; // entitlement-id i RevenueCat-dashboarden

let configured = false;
let configuredFor: string | null = null;

/**
 * `null` = utloggad: SDK:t konfigureras anonymt så arket och /priser kan visa
 * BUTIKENS planer även före inloggning (2026-10-20 — förut syntes bara
 * "Logga in för att uppgradera"). Köp kräver alltid ett id: då byter `logIn` det
 * anonyma id:t mot vårt, så webhooken får rätt app_user_id.
 */
async function ensureConfigured(userId: string | null) {
  if (configured) {
    if (userId && configuredFor !== userId) {
      await Purchases.logIn({ appUserID: userId });
      configuredFor = userId;
    }
    return;
  }
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
  configured = true;
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
export async function loadStorePlans(userId: string | null): Promise<StorePlans> {
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

/** Pro-medlemmens butiksprenumeration just nu (Pro-vyn på /priser). */
export interface CurrentStorePlan {
  /** Vilken av VÅRA planer, null = okänd produkt (ingen bytesknapp). */
  kind: "month" | "year" | null;
  productId: string;
  store: "app_store" | "play_store" | "other";
  /** 12-månadersplanen om ett byte går att erbjuda, annars null. */
  switchTo: StorePlanOption | null;
}

export async function loadCurrentStorePlan(userId: string): Promise<CurrentStorePlan | null> {
  await ensureConfigured(userId);
  const { customerInfo } = await Purchases.getCustomerInfo();
  const ent = customerInfo.entitlements.active[ENTITLEMENT];
  if (!ent) return null;
  const store = ent.store === "APP_STORE" ? "app_store" : ent.store === "PLAY_STORE" ? "play_store" : "other";
  // Ett köp i den ANDRA butiken (iPhone-köp, Android-telefon) går inte att byta härifrån.
  const here = Capacitor.getPlatform() === "ios" ? "app_store" : "play_store";
  const plans = await loadStorePlans(userId);
  const kind = currentPlanKind(ent.productIdentifier, plans, ent.productPlanIdentifier);
  return {
    kind,
    productId: ent.productIdentifier,
    store,
    switchTo: kind === "month" && store === here ? plans.year : null,
  };
}

/**
 * Byt en månadsprenumeration till 12 månader (2026-10-20). iOS: samma
 * prenumerationsgrupp ⇒ Apple byter själv och visar sitt eget ark. ⛔ ANDROID MÅSTE
 * FÅ DEN GAMLA PRODUKTEN: utan `googleProductChangeInfo` blir årsplanen en ANDRA
 * prenumeration bredvid månadsplanen och kunden betalar för båda. Tidsproration ⇒
 * bytet gäller direkt och återstående månadstid räknas av.
 * ⛔ `googleProductChangeInfo`, inte `storeProductChangeInfo`: Android 1.6.0 bär
 * plugin 13.2.3, och den nya formen finns inte där.
 */
export async function switchToYear(userId: string, oldProductId: string): Promise<boolean> {
  await ensureConfigured(userId);
  const pkg = await packageFor("year");
  if (!pkg) throw new Error("Ingen prenumeration tillgänglig just nu.");
  const { customerInfo } = await Purchases.purchasePackage({
    aPackage: pkg,
    ...(Capacitor.getPlatform() === "android"
      ? {
          googleProductChangeInfo: {
            oldProductIdentifier: oldProductId.split(":")[0],
            prorationMode: PRORATION_MODE.IMMEDIATE_WITH_TIME_PRORATION,
          },
        }
      : {}),
  });
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
