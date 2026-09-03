/**
 * Felkoder för autentiserings-API:erna (registrering, kod, glömt/återställ,
 * verifiering).
 *
 * ⛔ ROUTEN VET INTE VILKET SPRÅK ANVÄNDAREN LÄSER. Felen var tidigare
 * färdigskrivna SVENSKA meningar i svaret, och klienten visade dem ordagrant —
 * i den engelska appen stod alltså "Mejlet gick inte att skicka just nu." mitt
 * i ett engelskt formulär (uppmätt i Android-appen 2026-09-03, där emulatorns
 * locale är en-US). Klientens EGEN validering var översatt hela tiden, så
 * blandningen slog till först när servern svarade — det syntes inte i UI-passen.
 *
 * Svaret bär därför en stabil `code` som klienten översätter via
 * `Auth.serverErrors`. `error` följer med som RESERV och är fortfarande
 * svenska: en klient som inte känner koden (äldre appbyggnad i butiken, extern
 * konsument) ska visa något begripligt i stället för en tom ruta, och svenska
 * är appens standardspråk. ⛔ Ta aldrig bort `error` — den är kontraktet mot
 * alla byggnader som redan är ute.
 */

/** Alla koder de publika auth-routerna kan svara med. */
export type AuthErrorCode =
  | "rateLimited"
  | "tooManyRequests"
  | "emailTaken"
  | "nameTaken"
  | "codeThrottled"
  | "mailFailed"
  | "invalidId"
  | "codeMissing"
  | "codeExpired"
  | "codeLocked"
  | "codeWrong"
  | "resetLinkInvalid"
  | "verifyLinkInvalid";

/**
 * Svensk reservtext per kod. ⛔ Den här listan är FACIT för `Auth.serverErrors`
 * i messages/sv.json och messages/en.json — en kod utan översättning faller
 * tillbaka hit och blir svensk igen, vilket är precis felet vi lagade.
 * Vaktat av tests/unit/auth-error-messages.test.ts.
 */
export const AUTH_ERROR_FALLBACK_SV: Record<AuthErrorCode, string> = {
  rateLimited: "För många försök. Vänta en stund och försök igen.",
  tooManyRequests: "För många förfrågningar.",
  emailTaken: "Du har redan ett konto med den här e-postadressen – logga in istället.",
  nameTaken: "Användarnamnet är upptaget. Välj ett annat.",
  codeThrottled:
    "Vi har redan skickat flera koder till den adressen. Vänta en stund och försök igen.",
  mailFailed: "Mejlet gick inte att skicka just nu. Försök igen om en liten stund.",
  invalidId: "Ogiltigt id.",
  codeMissing: "Ingen kod är utfärdad för den här adressen. Tryck på ”Skicka kod” först.",
  codeExpired: "Koden har gått ut. Begär en ny kod.",
  codeLocked: "För många felaktiga försök. Begär en ny kod.",
  codeWrong: "Fel kod. Kontrollera mejlet och försök igen.",
  resetLinkInvalid: "Länken är ogiltig eller har gått ut. Begär en ny återställningslänk.",
  verifyLinkInvalid: "Ogiltig eller redan använd verifieringslänk.",
};

/**
 * Svarskroppen för ett auth-fel. `field` fäster felet vid ett formulärfält
 * (klienten hoppar då tillbaka till det steget) — samma kontrakt som förut.
 */
export function authError(
  code: AuthErrorCode,
  field?: "name" | "email"
): { error: string; code: AuthErrorCode; field?: "name" | "email" } {
  return field
    ? { error: AUTH_ERROR_FALLBACK_SV[code], code, field }
    : { error: AUTH_ERROR_FALLBACK_SV[code], code };
}
