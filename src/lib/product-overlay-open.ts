/**
 * Liten registry för att öppna produkt-overlayn IMPERATIVT från kort som
 * navigerar via onClick/router i stället för <a href> (t.ex. samlings-rutnätet).
 * Egen lättviktsmodul → anropare drar INTE in hela overlay-/detalj-UI:t i sin
 * bundle (det bor redan globalt i root-layouten). ProductOverlayHost registrerar
 * sin open()-funktion; klick-delegeringen sköter vanliga produktlänkar.
 */
let handler: ((slug: string) => void) | null = null;

export function registerOverlayOpen(fn: ((slug: string) => void) | null): void {
  handler = fn;
}

/**
 * Lyssnare som körs när overlayn öppnas (oavsett väg — klick-delegering eller
 * imperativt). Behövs för att UI under overlayn ska kunna städa sig själv:
 * overlayns klick-delegering kör preventDefault+stopPropagation i CAPTURE-fas,
 * så länkens egen onClick når aldrig fram (t.ex. sökförslags-dropdownen som
 * annars blev kvar ovanpå overlayn). Returnerar en avregistrerings-funktion.
 */
const openListeners = new Set<() => void>();

export function onProductOverlayOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => {
    openListeners.delete(fn);
  };
}

export function notifyProductOverlayOpen(): void {
  for (const fn of openListeners) fn();
}

/** Öppna overlayn; returnerar false om den inte är tillgänglig (ej touch / ej
 *  monterad) så anroparen kan falla tillbaka på vanlig navigering. */
export function openProductOverlay(slug: string): boolean {
  if (!handler || typeof window === "undefined") return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  handler(slug);
  return true;
}

/* ---------------------------------------------------------------------------
 * HELSKÄRMSVÄRDAR — overlayns z-index är inte en konstant
 *
 * Overlayn ligger normalt på z-40: precis över sidans egen header (annars dubbel
 * header) men UNDER bottenflikarna, som är z-40 men målas senare i DOM och
 * därför ska synas och gå att trycka på medan man bläddrar.
 *
 * Skannern bryter den premissen. Den är `fixed inset-0 z-[60]` för att lägga sig
 * över HELA appen (inklusive flikarna), så "Visa produkt" därifrån öppnade
 * overlayn UNDER kameravyn: klick-delegeringen körde, overlayn monterades och
 * hämtade sitt data — men användaren såg ingenting hända. Buggen var alltså
 * aldrig länken, den var målningsordningen.
 *
 * ⛔ Lös det INTE genom att permanent höja overlayn: då försvinner bottenflikarna
 * bakom den i den vanliga bläddringen, vilket är hela skälet till z-40.
 * En helskärmsvärd anmäler sig i stället medan den är monterad, och BARA då
 * lyfts overlayn över den. Flikarna är ändå redan dolda av värden i det läget,
 * så lyftet kostar ingenting.
 * ------------------------------------------------------------------------ */
let fullscreenHosts = 0;
const elevationListeners = new Set<(elevated: boolean) => void>();

/** Anmäl en helskärmsvy (skannern) medan den är monterad. Returnerar en
 *  avanmälningsfunktion — anropa den i effektens cleanup.
 *
 *  Räknare, inte en boolean: två värdar som överlappar under en övergång ska
 *  inte kunna nolla flaggan när den FÖRSTA av dem avmonteras. */
export function registerFullscreenHost(): () => void {
  fullscreenHosts += 1;
  if (fullscreenHosts === 1) for (const fn of elevationListeners) fn(true);
  let released = false;
  return () => {
    if (released) return; // idempotent: dubbel cleanup får inte räkna ner två gånger
    released = true;
    fullscreenHosts -= 1;
    if (fullscreenHosts === 0) for (const fn of elevationListeners) fn(false);
  };
}

/** Prenumerera på om overlayn måste ligga över en helskärmsvärd. */
export function onOverlayElevationChange(fn: (elevated: boolean) => void): () => void {
  elevationListeners.add(fn);
  return () => {
    elevationListeners.delete(fn);
  };
}

/** Nuvarande läge — för initialt state vid montering (värden kan ha anmält sig
 *  innan overlay-värden monterades). */
export function overlayIsElevated(): boolean {
  return fullscreenHosts > 0;
}
