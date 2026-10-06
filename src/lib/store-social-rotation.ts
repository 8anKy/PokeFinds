/**
 * Butiksnyheter: vilka konton en körning läser, och när två konton postar SAMMA text.
 *
 * ROTATION: Metas tak är 200 anrop/timme och lanen kör upp till ~4 ggr/h (kickoff var
 * ~20:e min + reservschemat). Med filialkonton är listan längre än en körning får läsa,
 * så varje körning läser högst `max` konton med start där förra slutade. Utan markören
 * hade 90 %-stoppet svultit SAMMA svans varje gång.
 *
 * DUBBLETTER: kedjornas filialer lägger ofta upp huvudkontorets text ordagrant. Samma
 * normaliserade text postas EN gång per `DUPLICATE_WINDOW_DAYS`, oavsett konto.
 */

export const DUPLICATE_WINDOW_DAYS = 7;

/** Högst `max` element med start vid `cursor` (varvar runt), och nästa markör. */
export function rotationSlice<T>(items: readonly T[], cursor: number, max: number): { picked: T[]; next: number } {
  const n = items.length;
  if (n === 0) return { picked: [], next: 0 };
  const start = ((Math.floor(cursor) % n) + n) % n;
  const count = Math.min(n, Math.max(0, max));
  const picked = Array.from({ length: count }, (_, i) => items[(start + i) % n]);
  return { picked, next: (start + count) % n };
}

/** Nyckel för "samma inlägg": bokstäver/siffror, gemener, de första 160 tecknen. Tom text ⇒ null. */
export function duplicateKey(body: string): string | null {
  const key = body
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 160);
  return key.length >= 20 ? key : null;
}
