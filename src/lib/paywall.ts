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
  /**
   * Vilket ark som ska upp. UTELÄMNA den normalt: värden avgör själv, och det är
   * poängen — varje Pro-låst yta i appen får då rätt prompt utan att veta något
   * om vem som tittar.
   *
   * ⛔ EN UTLOGGAD BESÖKARE SKA INTE SÄLJAS EN PRENUMERATION (ägarbeslut
   * 2026-09-09). Publika produktsidor låser Tradera-kurvan och MAX-perioden precis
   * som för en gratisanvändare, men den som inte ens har ett konto kan inte köpa
   * något meningsfullt först — hen ska be om ett konto, inte om ett kort.
   */
  mode?: "pro" | "signup";
  /**
   * FÖRHANDSVISNING i arket (2026-10-15): i stället för Pro-kortet ritas det som
   * prompten handlar om — användarens EGET kort i sin slab. Arket är fortfarande
   * samma ark (samma rader, samma köpknapp); bara bilden högst upp byts.
   */
  preview?: PaywallPreview;
}

export type PaywallPreview = PaywallSlabPreview | PaywallCardPreview;

export interface PaywallSlabPreview {
  kind: "slab";
  imageUrl: string | null;
  /** Normaliserat bolag (`GradingIssuer`). */
  issuer: string;
  gradeTenths: number;
  name: string;
}

/**
 * KORTET MAN STOD PÅ (design "A+", 2026-10-19): bild, namn, set och priset man redan
 * ser — plus de två låsta raderna (Tradera sålt, graderat sålt). ⛔ De låsta talen
 * skickas ALDRIG hit: arket ritar en suddig platshållare. Ett riktigt tal i DOM:en
 * vore Pro-data till den som inte betalat, bara gömt bakom en CSS-oskärpa.
 */
export interface PaywallCardPreview {
  kind: "card";
  imageUrl: string | null;
  name: string;
  setName: string | null;
  /** Priset produktsidan redan visar (öre), null = "–". */
  priceOre: number | null;
  /** Visa raden "graderat sålt" — bara för singlar. */
  graded: boolean;
  /** Prisgrafens publika kurva (öre, äldst först) — kortets lilla linje. Aldrig Pro-data. */
  trend?: number[] | null;
}

import { track } from "@/lib/track";

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
  // Tratten: varje prompt räknas på sin källa, oavsett om arket eller sidan
  // visas. UpgradeButton läser samma källa vid klicket (lastPaywallSource).
  lastSource = opts?.source ?? "unknown";
  track("paywall_open", lastSource);
  if (!openPaywall(opts)) router.push(opts?.mode === "signup" ? "/registrera" : "/priser");
}

let lastSource: string | null = null;

/** Källan bakom den senast öppnade prompten — UpgradeButton stämplar sitt klick med den. */
export function lastPaywallSource(): string | null {
  return lastSource;
}
