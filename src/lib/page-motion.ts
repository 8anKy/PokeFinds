/**
 * Gemensam rörelse för vyer som skjuts ovanpå varandra. Kurva och tider bor
 * här så produkt-overlayn och riktiga SwipeBack-rutter inte glider isär igen.
 */
export const PAGE_MOTION_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const PAGE_ENTER_DURATION_MS = 420;

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

/**
 * Mer kvarvarande sträcka ger längre landning, men aldrig så lång att ett
 * godkänt halvsvep känns som att vyn har hängt sig. Historikstädningen sker
 * först EFTER att den synliga rörelsen är klar, så den här tiden är bara det
 * användaren faktiskt ser.
 */
export function swipeSettleDuration(progress: number, completing: boolean): number {
  const p = clampProgress(progress);
  const remaining = completing ? 1 - p : p;
  return Math.round(180 + remaining * 160);
}

export function pageMotionTransition(property: "transform" | "opacity", durationMs: number): string {
  return `${property} ${durationMs}ms ${PAGE_MOTION_EASING}`;
}
