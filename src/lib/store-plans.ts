/**
 * Vilka App Store-/Play-paket arket visar (2026-10-19) — ren dom över RevenueCats
 * offering, testad i tests/unit/store-plans.test.ts. Typerna är medvetet lösa (bara
 * fälten vi läser) så att modulen inte drar in Capacitor i testerna.
 *
 * Valet görs på PRODUKTENS data, aldrig på paketets id — id:t sätts för hand i
 * RevenueCat-dashboarden och glider, produktens period och avbetalningsinfo gör det inte.
 *
 *   • year = Apples 12-månadersåtagande (`installmentsInfo`, 12 betalningar) om det
 *     finns, annars den förbetalda årsplanen (P1Y). Åtagandet kräver RevenueCat-SDK
 *     ≥ 13.7.4 i det NATIVA bygget och iOS ≥ 26.4 — äldre appar/telefoner får
 *     årsplanen förbetald. Android får alltid den förbetalda (465 kr/år).
 *   • month = P1M utan åtagande.
 *
 * Priserna visas som BUTIKEN formaterat dem (`priceString`), aldrig som våra egna
 * konstanter: Apple och Google underkänner ett köpställe där priset vid knappen inte
 * är butikens.
 */

export interface StorePeriodLike {
  unit: string;
  value: number;
}

export interface StoreProductLike {
  identifier: string;
  priceString: string;
  subscriptionPeriod: string | null;
  pricePerMonthString?: string | null;
  introPrice?: { price: number; periodUnit: string; periodNumberOfUnits: number } | null;
  installmentsInfo?: {
    commitmentPaymentsCount: number;
    installmentBillingPriceString: string | null;
    commitmentTotalPriceString: string | null;
  } | null;
  defaultOption?: { freePhase?: { billingPeriod: StorePeriodLike } | null } | null;
}

export interface StorePackageLike {
  identifier: string;
  product: StoreProductLike;
}

export type StorePlanKind = "month" | "commit" | "annual";

export interface StorePlanOption {
  packageId: string;
  productId: string;
  kind: StorePlanKind;
  /** Det stora priset på raden: "59 kr" (månad), "39 kr" (åtagande), "465 kr" (år). */
  price: string;
  /** "/mån" eller "/år" — enheten till `price`. */
  per: "month" | "year";
  /** Totalen för åtagandet ("468 kr") eller månadspriset för årsplanen ("39 kr"). */
  secondary: string | null;
  /** Gratisdagar enligt butiken, null = ingen provperiod (eller inte berättigad). */
  trialDays: number | null;
}

const UNIT_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

function toDays(unit: string, value: number): number | null {
  const d = UNIT_DAYS[unit.toUpperCase()];
  return d && value > 0 ? d * value : null;
}

export function trialDaysFor(product: StoreProductLike): number | null {
  const intro = product.introPrice;
  if (intro && intro.price === 0) return toDays(intro.periodUnit, intro.periodNumberOfUnits);
  const free = product.defaultOption?.freePhase?.billingPeriod;
  return free ? toDays(free.unit, free.value) : null;
}

function isCommitment(p: StoreProductLike): boolean {
  return (p.installmentsInfo?.commitmentPaymentsCount ?? 0) === 12;
}

export function pickStorePlans(packages: StorePackageLike[]): {
  month: StorePlanOption | null;
  year: StorePlanOption | null;
} {
  let month: StorePlanOption | null = null;
  let commit: StorePlanOption | null = null;
  let annual: StorePlanOption | null = null;

  for (const pkg of packages) {
    const p = pkg.product;
    const base = { packageId: pkg.identifier, productId: p.identifier, trialDays: trialDaysFor(p) };
    if (isCommitment(p)) {
      commit ??= {
        ...base,
        kind: "commit",
        price: p.installmentsInfo?.installmentBillingPriceString ?? p.priceString,
        per: "month",
        secondary: p.installmentsInfo?.commitmentTotalPriceString ?? null,
      };
    } else if (p.subscriptionPeriod === "P1Y") {
      annual ??= { ...base, kind: "annual", price: p.priceString, per: "year", secondary: p.pricePerMonthString ?? null };
    } else if (p.subscriptionPeriod === "P1M") {
      month ??= { ...base, kind: "month", price: p.priceString, per: "month", secondary: null, trialDays: null };
    }
  }
  return { month, year: commit ?? annual };
}

/**
 * Vilken av våra planer en aktiv prenumeration är (Pro-vyn, 2026-10-20) — ur
 * entitlementens `productIdentifier` + `productPlanIdentifier`.
 *
 * ⛔ PÅ PLAY ÄR MÅNAD OCH ÅR SAMMA PRODUKT (`foilio_pro_monthly`, basplanerna
 * `monthly`/`yearly`) — produkten ensam säger ingenting. Basplanen avgör då:
 * `foilio_pro_monthly` + `monthly` ⇒ "foilio_pro_monthly:monthly", exakt som
 * erbjudandets produkt-id. iOS har ingen basplan; där är produkterna olika
 * (`premium_monthly` / `premium_yearly`) och basen före ":" jämförs (åtagandet
 * heter `premium_yearly:monthly` i RevenueCat). Delar planerna bas och basplanen
 * saknas ⇒ null hellre än en gissning (ingen bytesknapp).
 */
export function currentPlanKind(
  activeProductId: string | null | undefined,
  plans: { month: StorePlanOption | null; year: StorePlanOption | null },
  activePlanId?: string | null
): "month" | "year" | null {
  if (!activeProductId) return null;
  const base = (id: string) => id.split(":")[0];
  if (activePlanId) {
    const full = `${base(activeProductId)}:${activePlanId}`;
    if (plans.year?.productId === full) return "year";
    if (plans.month?.productId === full) return "month";
  }
  const active = base(activeProductId);
  const yearBase = plans.year ? base(plans.year.productId) : null;
  const monthBase = plans.month ? base(plans.month.productId) : null;
  if (yearBase && yearBase === monthBase) return null;
  if (yearBase === active) return "year";
  if (monthBase === active) return "month";
  return null;
}
