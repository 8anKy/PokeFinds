/**
 * När ställde DEN HÄR PROCESSEN senast en fråga till databasen? (2026-10-12)
 *
 * Används av lagersynkarna från Discord-lanen: en synk får bara skrivas när Neon REDAN
 * är vaken (kostnadsdoktrinen — en väckning köper minst 300 s). Lanen erbjuder sina
 * köade synkar en gång i minuten; rutten svarar "deferred" utan DB-arbete om ingen
 * fråga gått på `DB_AWAKE_PIGGYBACK_MS`. Inom det fönstret förlänger synken den vakna
 * tiden med högst lika mycket — och oftast inte alls, för trafiken som höll databasen
 * vaken fortsätter.
 *
 * ⛔ Bara den här processens frågor syns (Railway kör en instans). GitHub-jobbens
 *    frågor syns inte — då skjuts synken upp i onödan, aldrig tvärtom.
 */
let lastDbActivityAt = 0;

export const DB_AWAKE_PIGGYBACK_MS = 20_000;

export function noteDbActivity(now = Date.now()): void {
  lastDbActivityAt = now;
}

export function dbIdleMs(now = Date.now()): number {
  return lastDbActivityAt === 0 ? Infinity : now - lastDbActivityAt;
}
