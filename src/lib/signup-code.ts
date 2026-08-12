import crypto from "crypto";
import { hashToken } from "@/lib/tokens";

/**
 * Engångskod som bevisar e-postägarskap FÖRE kontot skapas ("Skicka kod" i
 * registreringen). Ren dom utan DB — API-routen äger läs/skriv, den här modulen
 * äger reglerna, så de går att testa utan Postgres (samma mönster som
 * evaluateStockFlap).
 *
 * SKILD från User.verificationToken (länk-flödet för REDAN skapade konton):
 * två gamla obekräftade konton lever på tokens utan utgångstid, och det flödet
 * lämnas orört. Koder här är pre-konto och FÅR gå ut utan att stranda någon —
 * den som missar fönstret begär bara en ny.
 */

export const SIGNUP_CODE_TTL_MS = 15 * 60_000;

/**
 * Fel gissningar innan koden låses. 6 siffror = 1 000 000 kombinationer;
 * med 5 försök per utfärdad kod är gissning meningslös även om IP-spärren
 * skulle rundas (roterande IP:n ändrar inte attempts-räknaren, den bor på raden).
 */
export const SIGNUP_CODE_MAX_ATTEMPTS = 5;

/** Kryptografiskt slumpad 6-siffrig kod, alltid nollutfylld ("004217"). */
export function generateSignupCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export interface SignupCodeRow {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

export type SignupCodeVerdict = "ok" | "missing" | "expired" | "locked" | "wrong";

/**
 * Domen över ett registreringsförsök. Ordningen är medveten: en utgången eller
 * låst kod svarar det ÄVEN när gissningen råkar vara rätt — annars vore
 * låsningen ingen låsning.
 */
export function evaluateSignupCode(
  row: SignupCodeRow | null,
  code: string,
  now: Date
): SignupCodeVerdict {
  if (!row) return "missing";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.attempts >= SIGNUP_CODE_MAX_ATTEMPTS) return "locked";
  // Jämförelsen går via hashToken (EN hash-implementation, se tokens.ts) och
  // timingSafeEqual — hex-strängarna är alltid lika långa (SHA-256).
  const expected = Buffer.from(row.codeHash, "utf8");
  const actual = Buffer.from(hashToken(code), "utf8");
  if (expected.length !== actual.length) return "wrong";
  return crypto.timingSafeEqual(expected, actual) ? "ok" : "wrong";
}

/** Lagringsformen av en kod — samma envägshash som verifierings-/reset-tokens. */
export function hashSignupCode(code: string): string {
  return hashToken(code);
}
