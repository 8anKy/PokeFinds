/**
 * Rena beslut för svep-gester: flik-svep (ui/swipe-tabs) och kant-svep tillbaka
 * (ui/swipe-back). Trösklarna bor här så att ett svep känns likadant i profilens
 * flikar, forumets sparade-vy och bakåt-svepet — och så att besluten går att
 * testa utan DOM.
 *
 * Samma tröskel som produkt-overlayns stäng-svep (en fjärdedel av bredden), plus
 * ett snärt-undantag: ett kort men snabbt drag räknas också, annars känns flikar
 * sega. Riktningslåset (8 px) är detsamma som overlayn använder: vertikalt =
 * native scroll, horisontellt = vår gest.
 */

/** Fingret måste röra sig så här långt innan vi vet om det är ett svep eller en scroll. */
export const AXIS_LOCK_PX = 8;
/** Kantzon från vänster där ett svep betyder "tillbaka", aldrig "nästa flik". */
export const EDGE_ZONE_PX = 28;
/** Snärt: snabbare än så här (px/ms) räcker även om draget är kort. */
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;

export type SwipeAxis = "x" | "y";

/** null tills fingret rört sig AXIS_LOCK_PX åt något håll. */
export function lockAxis(dx: number, dy: number): SwipeAxis | null {
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** Motstånd förbi första/sista fliken: ytan följer fingret med en tredjedel. */
export function rubberBand(dx: number): number {
  return dx / 3;
}

export interface SwipeInput {
  /** Fingrets förflyttning i px sedan touchstart (negativt = åt vänster). */
  dx: number;
  /** Ytans bredd i px. */
  width: number;
  /** dx / tid, px per ms, med tecken. */
  velocityPxPerMs: number;
}

function passes({ dx, width, velocityPxPerMs }: SwipeInput): boolean {
  const far = Math.abs(dx) > width / 4;
  const flick = Math.abs(velocityPxPerMs) > FLICK_PX_PER_MS && Math.abs(dx) > FLICK_MIN_PX;
  return far || flick;
}

/**
 * -1 = föregående flik, 1 = nästa flik, 0 = stanna. Svep åt vänster (dx < 0)
 * betyder nästa. Vid en kant (canPrev/canNext falskt) stannar vi — fingret fick
 * motstånd under draget, se rubberBand.
 */
export function resolveTabSwipe(
  input: SwipeInput & { canPrev: boolean; canNext: boolean }
): -1 | 0 | 1 {
  if (!passes(input)) return 0;
  if (input.dx < 0) return input.canNext ? 1 : 0;
  return input.canPrev ? -1 : 0;
}

/** Kant-svep tillbaka: bara åt höger räknas. */
export function resolveBackSwipe(input: SwipeInput): boolean {
  return input.dx > 0 && passes(input);
}
