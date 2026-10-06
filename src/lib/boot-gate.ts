/**
 * KALLSTARTENS GRIND (2026-10-06): den native splashen döljs först när den första
 * uppdateringskollen är klar (`UpdateScreen`), så att en ny version visas DIREKT
 * i stället för efter en blixt av katalogen (ägarens rapport 2026-10-06).
 *
 * ⛔ Grinden får aldrig hålla appen som gisslan: `AppBoot` väntar högst
 *    `BOOT_GATE_TIMEOUT_MS` — ett segt nät ger den gamla ordningen, aldrig en
 *    splash som står kvar.
 */
export const BOOT_GATE_TIMEOUT_MS = 2500;

let release: () => void = () => {};
const checked = new Promise<void>((resolve) => {
  release = resolve;
});

/** Anropas när första kollen är klar OCH dess resultat är renderat. */
export function markUpdateCheckDone(): void {
  release();
}

/** Löses när uppdateringskollen är klar, eller efter `timeoutMs`. */
export function waitForUpdateCheck(timeoutMs = BOOT_GATE_TIMEOUT_MS): Promise<void> {
  return Promise.race([checked, new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))]);
}
