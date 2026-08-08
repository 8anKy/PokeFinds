import crypto from "crypto";

/**
 * Enkelriktad hash för e-post-verifierings- och lösenordsåterställnings-tokens.
 *
 * Råtoken skickas i mejllänken; DATABASEN håller bara hashen. Ett läckt DB-utdrag
 * (eller en backup som hamnar fel) kan då inte användas för att ta över konton med
 * väntande återställning/verifiering — hashen går inte att vända till en giltig
 * länk. SHA-256 räcker: token är redan 32 slumpade byte (hög entropi), så någon
 * långsam lösenords-KDF behövs inte.
 *
 * ⛔ Både lagring OCH uppslag måste gå via den HÄR funktionen — hashar den ena
 * sidan men inte den andra slutar varje länk att matcha, tyst och bara i drift.
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
