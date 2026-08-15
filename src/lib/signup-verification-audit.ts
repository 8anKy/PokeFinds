/**
 * Klassificering och gallringsdom för `SignupVerification` — väntrummet mellan
 * "Skicka kod" och ett riktigt konto.
 *
 * Ren funktion utan DB, så gallringsregeln går att testa: en rad som raderas
 * för tidigt ger "koden är ogiltig" för någon som fick sin kod nyss, och det
 * felet syns bara i produktion, bara för den som råkade vara mitt i flödet.
 */
import { SIGNUP_CODE_MAX_ATTEMPTS } from "@/lib/signup-code";

/**
 * Hur länge en utgången rad får ligga kvar innan den städas.
 * Koden lever 15 minuter — karensen är alltså inte till för koden utan för
 * MÄNNISKAN: den som skrev fel adress ska hinna komma tillbaka nästa morgon och
 * se ett begripligt fel i stället för "koden finns inte" på en rad vi hann ta bort.
 */
export const GRACE_HOURS = 24;

export interface SignupVerificationRow {
  email: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

export interface SignupVerificationReport {
  total: number;
  /** Koden gäller fortfarande — rör aldrig. */
  active: number;
  /** Utgången men inom karensen — rör inte än. */
  withinGrace: number;
  /** E-postadresser som är säkra att radera. */
  purgeable: string[];
  buckets: {
    /** Ingen kod prövades. Mejlet kom inte fram, eller öppnades aldrig. */
    neverTried: number;
    /** Hade mejlet, gissade fel några gånger, gav upp. */
    gaveUpTyping: number;
    /** Slog i femförsökstaket. */
    lockedOut: number;
    /** Adressen tillhör ett befintligt konto — personen ÄR användare. */
    alreadyUser: number;
  };
  oldest: Date | null;
  /** De vanligaste domänerna bland avhoppen, "gmail.com (4)". */
  topDomains: string[];
}

/**
 * ⛔ `alreadyUser` räknas FÖRE de andra hinkarna. En rad vars adress redan är ett
 * konto är inte ett avhopp — det är en rättad adress eller ett andra försök, dvs.
 * en SUCCÉ vars väntrumsrad blev kvar (raderingen i register-routen är nycklad på
 * adressen som faktiskt användes). Räknas den som "gav upp" ser tratten sämre ut
 * än den är, och siffran blir värdelös som beslutsunderlag.
 */
export function classifySignupRows(
  rows: SignupVerificationRow[],
  existingUserEmails: Set<string>,
  now: Date
): SignupVerificationReport {
  const graceCutoff = now.getTime() - GRACE_HOURS * 3600_000;
  const report: SignupVerificationReport = {
    total: rows.length,
    active: 0,
    withinGrace: 0,
    purgeable: [],
    buckets: { neverTried: 0, gaveUpTyping: 0, lockedOut: 0, alreadyUser: 0 },
    oldest: null,
    topDomains: [],
  };

  const domainCounts = new Map<string, number>();

  for (const row of rows) {
    if (!report.oldest || row.createdAt < report.oldest) report.oldest = row.createdAt;

    if (row.expiresAt.getTime() > now.getTime()) {
      report.active++;
      continue;
    }
    if (row.expiresAt.getTime() > graceCutoff) {
      report.withinGrace++;
      continue;
    }

    report.purgeable.push(row.email);

    if (existingUserEmails.has(row.email)) {
      report.buckets.alreadyUser++;
      continue; // ingen avhoppsanalys på någon som faktiskt registrerade sig
    }
    if (row.attempts >= SIGNUP_CODE_MAX_ATTEMPTS) report.buckets.lockedOut++;
    else if (row.attempts > 0) report.buckets.gaveUpTyping++;
    else report.buckets.neverTried++;

    const domain = row.email.slice(row.email.lastIndexOf("@") + 1);
    if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  report.topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([domain, count]) => `${domain} (${count})`);

  return report;
}
