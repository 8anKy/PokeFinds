/**
 * Lanseringskampanj: nya konton får gratis Pro under en BEGRÄNSAD
 * registreringsperiod ("registrera före den 26 augusti → två månader gratis").
 *
 * ⛔ **INERT TILLS `SIGNUP_BONUS_UNTIL` SÄTTS.** Utan variabeln händer ingenting
 * alls — koden kan alltså deployas långt innan en enda kreatör är bokad, och
 * kampanjen startas genom att sätta ett datum på Railway (ingen deploy).
 *
 * ⛔ **TVÅ HELT OLIKA DATUM, BLANDA ALDRIG IHOP DEM:**
 *   `SIGNUP_BONUS_UNTIL`  = sista dagen någon kan REGISTRERA sig och få gåvan.
 *                           Kampanjfönstret. Det datum som står i videon.
 *   `bonusProUntil`       = hur länge DEN användarens Pro gäller (registrering
 *                           + `SIGNUP_BONUS_MONTHS`). Personligt, olika för alla.
 * Den som registrerar sig sista dagen får alltså fulla två månader — kampanjen
 * stänger dörren, den klipper inte av dem som redan kommit in.
 *
 * ⛔ **ERBJUDANDETS FÖNSTER ≠ KREATÖRSLÄNKENS LIVSLÄNGD.** Koderna i
 * /admin/kreatorer lever vidare (90 dagar) så attributionen fortsätter mäta vilken
 * kreatör som levererade även efter att gåvan tagit slut. Kort erbjudande, lång
 * mätning — se lib/creator-ref.ts.
 */

/** Hur många månaders Pro en ny användare får under kampanjen. */
export const DEFAULT_SIGNUP_BONUS_MONTHS = 2;

export interface SignupCampaignConfig {
  /** Sista registreringsdag, YYYY-MM-DD. Saknas/ogiltigt ⇒ ingen kampanj. */
  until?: string | null;
  /** Antal månaders Pro. Default 2. */
  months?: string | number | null;
}

/** Läser kampanjen ur miljön. Egen funktion så testerna slipper röra process.env. */
export function signupCampaignFromEnv(): SignupCampaignConfig {
  return {
    until: process.env.SIGNUP_BONUS_UNTIL,
    months: process.env.SIGNUP_BONUS_MONTHS,
  };
}

function parseMonths(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_SIGNUP_BONUS_MONTHS;
  const n = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  // ⛔ Ett trasigt värde får inte tyst bli 0 månader — då hade kampanjen sett
  // påslagen ut men delat ut en gåva som gick ut i samma sekund.
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SIGNUP_BONUS_MONTHS;
  return Math.min(n, 24);
}

/** Är kampanjen öppen just nu? Sista dagen räknas HELT (t.o.m. midnatt UTC). */
export function campaignIsOpen(config: SignupCampaignConfig, now: Date): boolean {
  const until = config.until?.trim();
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
  const deadline = new Date(`${until}T23:59:59.999Z`);
  if (Number.isNaN(deadline.getTime())) return false;
  return now.getTime() <= deadline.getTime();
}

/**
 * Vilket `bonusProUntil` ett konto som registreras NU ska få — eller null när
 * kampanjen är stängd eller inte konfigurerad.
 *
 * ⛔ Räknas från REGISTRERINGEN, inte från kampanjens slut. Annars hade den som
 * kom sista dagen fått mindre än den som kom först, för samma erbjudande.
 */
export function signupBonusUntil(
  config: SignupCampaignConfig,
  now: Date
): Date | null {
  if (!campaignIsOpen(config, now)) return null;
  const until = new Date(now);
  until.setUTCMonth(until.getUTCMonth() + parseMonths(config.months));
  return until;
}
