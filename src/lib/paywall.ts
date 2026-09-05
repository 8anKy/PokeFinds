/**
 * Paywallen öppnas PÅ PLATS, aldrig som en sidnavigering (ägarbeslut 2026-09-05).
 *
 * Varje Pro-låst yta i appen (Max-perioden i grafen, Tradera-lagret, set-bevakning,
 * bulkskanning, kvottak, "Uppgradera"-knappar) skickade förr användaren till `/priser`
 * med `router.push`. I appen känns det som att lämna det man höll på med: kameravyn
 * stängs, grafen försvinner, och när köpet är klart står man på en annan sida än den
 * man ville använda. Nu glider ett bottenark upp över den aktuella vyn i stället —
 * samma form som filter- och snabbtilläggsarken (`bottom-sheet.tsx`).
 *
 * Samma mönster som `product-overlay-open.ts`: värden (`PaywallSheetHost` i rot-
 * layouten) registrerar sin öppningsfunktion, anropare importerar BARA den här lilla
 * modulen och drar inte in arkets UI i sin bundle.
 *
 * ⛔ `/priser` FINNS KVAR och är oförändrad som mål: den är SEO-sidan, Mer-tabbens
 * "Prenumeration", Stripes återkomst-URL och den sida App Store-granskaren läser.
 * Arket är en snabbare väg till samma köpknapp (`UpgradeButton`), inte en andra
 * paywall — copyn (spec-raderna) kommer ur samma meddelandenycklar och följer samma
 * pausflaggor.
 */
export interface PaywallOpenOptions {
  /** Varifrån prompten kom ("chart-max", "scanner-bulk"…) — bara för framtida mätning. */
  source?: string;
}

let handler: ((opts?: PaywallOpenOptions) => void) | null = null;

export function registerPaywallOpen(fn: ((opts?: PaywallOpenOptions) => void) | null): void {
  handler = fn;
}

/**
 * Öppna arket; false om värden inte är monterad (SSR, en route utan rot-layout,
 * ett test). Ingen `window`-koll behövs: värden registrerar sig ur en useEffect,
 * så på servern är `handler` alltid null.
 */
export function openPaywall(opts?: PaywallOpenOptions): boolean {
  if (!handler) return false;
  handler(opts);
  return true;
}

/**
 * Den vanliga anroparformen: arket om det finns, annars prissidan som förr. Fallbacken
 * gör att ingen låst yta någonsin blir en död knapp, även om värden inte hunnit
 * monteras.
 */
export function openPaywallOrNavigate(
  router: { push: (href: string) => void },
  opts?: PaywallOpenOptions
): void {
  if (!openPaywall(opts)) router.push("/priser");
}
