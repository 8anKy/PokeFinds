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

/** Öppna overlayn; returnerar false om den inte är tillgänglig (ej touch / ej
 *  monterad) så anroparen kan falla tillbaka på vanlig navigering. */
export function openProductOverlay(slug: string): boolean {
  if (!handler || typeof window === "undefined") return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  handler(slug);
  return true;
}
