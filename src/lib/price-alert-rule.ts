/**
 * PRISLARMETS DOM — ren funktion, ingen DB (2026-09-06, lagningen av de sex defekterna
 * i `price-alerts-pause.ts`).
 *
 * En bevakning larmar på produktens LÄGSTA KÖPBARA pris (i lager + direktlänk + > 0 kr,
 * samma urval som produktsidans rubrikpris — aldrig den offer som råkade röra sig), i
 * ett av två lägen:
 *
 *  · MÅLPRIS (`targetPrice` satt): larma när lägsta köpbara ≤ målet. ⛔ ETT LARM PER
 *    GÅNG MÅLET NÅS, inte per prisrörelse under målet: spärren (`priceAlertFiredOre`)
 *    sätts när larmet går och släpps först när priset åter ligger ÖVER målet
 *    (`shouldRearm`). Mätt före lagningen: samma produkt+användare 7 ggr på 30 dygn.
 *  · PRISFALL (inget mål): larma när lägsta köpbara fallit tydligt — minst
 *    `minPercent` OCH `minOre` — från utgångsläget, som är det pris vi senast larmade om
 *    (spärren) eller, före första larmet, det pris användaren SENAST SÅG (`previousOre`,
 *    produktens cachade lägstapris). Spärren släpps när priset stigit `rearmPercent`
 *    över larmnivån, så ett fall efter en uppgång larmar igen.
 *    Taket `maxPercent` finns för att ett fall på > 60 % oftare är en felmatchad offer
 *    eller en parser-miss än ett pris — samma spak som Discord-lanens prisinlägg.
 *
 * ⛔ 0 kr är inget pris (CLAUDE.md-invarianten) — `isPrice` kräver > 0 åt båda hållen.
 * ⛔ Policyn läses vid ANROPET, aldrig på modulnivå (Railway/Actions-regeln).
 */

export interface PriceAlertPolicy {
  /** Minsta prisfall i procent av utgångsläget (prisfall-läget). */
  minPercent: number;
  /** Minsta prisfall i öre — båda golven måste klaras (5 % av 40 kr är brus). */
  minOre: number;
  /** Största fall vi tror på; över det är det troligare fel data än ett pris. */
  maxPercent: number;
  /** Hur många procent ÖVER larmnivån priset måste stiga för att prisfall-spärren släpps. */
  rearmPercent: number;
}

export function priceAlertPolicy(): PriceAlertPolicy {
  const num = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    minPercent: num("PRICE_ALERT_MIN_PERCENT", 5),
    minOre: num("PRICE_ALERT_MIN_ORE", 1000),
    maxPercent: num("PRICE_ALERT_MAX_PERCENT", 60),
    rearmPercent: num("PRICE_ALERT_REARM_PERCENT", 10),
  };
}

/** Det av en bevakning domen behöver. */
export interface PriceWatchState {
  /** Öre, eller null = prisfall-läget. */
  targetPrice: number | null;
  /** Spärren: priset vi senast larmade om. null = spänd (får larma). */
  priceAlertFiredOre: number | null;
}

export type PriceAlertVerdict =
  | { fire: true; kind: "PRICE_TARGET" }
  | { fire: true; kind: "PRICE_DROP"; baselineOre: number; dropOre: number; percent: number }
  | { fire: false; reason: PriceAlertSkipReason };

export type PriceAlertSkipReason =
  /** Inget köpbart pris (inget i lager med direktlänk, eller 0 kr). */
  | "no-price"
  /** Målpris-läget: priset ligger över målet. */
  | "above-target"
  /** Vi har redan larmat för den här gången målet nåddes — priset har inte varit över målet sedan dess. */
  | "latched"
  /** Prisfall-läget utan utgångsläge (ingen spärr och inget tidigare pris). */
  | "no-baseline"
  /** Priset är inte lägre än utgångsläget. */
  | "not-cheaper"
  /** Under procent- eller öresgolvet. */
  | "too-small"
  /** Över taket — troligare fel data än ett pris. */
  | "implausible";

export function judgePriceAlert(
  watch: PriceWatchState,
  currentOre: number | null | undefined,
  previousOre: number | null | undefined,
  policy: PriceAlertPolicy
): PriceAlertVerdict {
  if (!isPrice(currentOre)) return { fire: false, reason: "no-price" };

  if (watch.targetPrice != null) {
    if (currentOre > watch.targetPrice) return { fire: false, reason: "above-target" };
    // Spärren gäller bara om det senaste larmet var ett MÅLPRIS-larm (låg på eller under
    // målet). Ett äldre prisfall-larm över målet är ett annat besked och spärrar inte.
    if (watch.priceAlertFiredOre != null && watch.priceAlertFiredOre <= watch.targetPrice) {
      return { fire: false, reason: "latched" };
    }
    return { fire: true, kind: "PRICE_TARGET" };
  }

  const baseline = isPrice(watch.priceAlertFiredOre) ? watch.priceAlertFiredOre : previousOre;
  if (!isPrice(baseline)) return { fire: false, reason: "no-baseline" };
  const dropOre = baseline - currentOre;
  if (dropOre <= 0) return { fire: false, reason: "not-cheaper" };
  const percent = (dropOre / baseline) * 100;
  if (percent < policy.minPercent || dropOre < policy.minOre) return { fire: false, reason: "too-small" };
  if (percent > policy.maxPercent) return { fire: false, reason: "implausible" };
  return { fire: true, kind: "PRICE_DROP", baselineOre: baseline, dropOre, percent };
}

/**
 * Ska spärren släppas? Målpris-läget: priset ligger över målet igen. Prisfall-läget:
 * priset har stigit `rearmPercent` över larmnivån. Okänt pris släpper aldrig — "vi vet
 * inte" är inget skäl att larma om igen.
 */
export function shouldRearm(
  watch: PriceWatchState,
  currentOre: number | null | undefined,
  policy: PriceAlertPolicy
): boolean {
  if (watch.priceAlertFiredOre == null) return false;
  if (!isPrice(currentOre)) return false;
  if (watch.targetPrice != null) return currentOre > watch.targetPrice;
  // Heltalsaritmetik: 90 000 × 1,1 är 99 000,00000000001 i flyttal och missar jämnt.
  return currentOre * 100 >= watch.priceAlertFiredOre * (100 + policy.rearmPercent);
}

export function isPrice(ore: number | null | undefined): ore is number {
  return typeof ore === "number" && Number.isFinite(ore) && ore > 0;
}
