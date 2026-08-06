/**
 * Synk mellan NextAuths riktiga sessionscookie och `fo_auth`-UI-hinten.
 *
 * ⛔ **`document.cookie` KAPAS TILL 7 DYGN AV WEBKIT — HINTEN MÅSTE SÄTTAS AV SERVERN.**
 * `setAuthHint()` (`src/lib/auth-hint.ts`) skriver hinten från KLIENTEN med
 * `max-age` 30 dygn, exakt som sessionen. Safari/WKWebView kapar sedan Safari 13.1
 * ALLA cookies som skapats via `document.cookie` till 7 dygn — det gäller iPhone-
 * Safari, Chrome på iOS OCH vår Capacitor-app (alla är WKWebView). Sessionen är
 * server-satt och HttpOnly och överlever därför i 30 dygn, men hinten dog efter 7.
 *
 * Och hinten är inte kosmetisk: `AuthHintGate` SKICKAR TILL /logga-in när den
 * saknas. Följden var att varje iPhone-användare kastades ut ur appen senast var
 * sjunde dygn medan sessionen levde vidare — "helt plötsligt utloggad", som
 * inträffade lika ofta för alla på iOS och aldrig på desktop-Chrome.
 *
 * Middleware jämför därför de två cookiesarna vid varje sidladdning och rättar
 * hinten med ett `Set-Cookie` FRÅN SERVERN (som ITP inte kapar). Kostnad: två
 * cookie-uppslag, noll krypto, noll DB. Ingen skrivning sker när de är eniga.
 *
 * ⛔ Vi läser bara att sessionscookien FINNS, vi verifierar den inte. Hinten är
 * per definition en gissning som servern ändå överprövar (middleware + API), och
 * en HMAC-verifiering per publik sidvisning vore att betala krypto för ett
 * UI-tips. Webbläsaren släpper själv cookien vid utgång, så "finns" ≈ "inte
 * utgången". Den riktiga kollen ligger kvar där den hör hemma: `getToken` på de
 * skyddade vägarna, som rensar hinten när token inte går att lösa upp.
 */

/** NextAuth v4 döper sessionscookien olika beroende på om origin är säkert. */
export const SESSION_COOKIE_NAMES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;

/** Namnet på UI-hinten. Speglar `NAME` i auth-hint.ts (klientsidan). */
export const AUTH_HINT_COOKIE = "fo_auth";

/** 30 dygn — samma som sessionens maxAge i authOptions. */
export const AUTH_HINT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Vad hinten behöver för att komma i takt med sessionen.
 * Ren funktion så beslutet går att testa utan Request/Response.
 */
export function authHintAction(
  hasSession: boolean,
  hasHint: boolean
): "set" | "clear" | "none" {
  if (hasSession === hasHint) return "none";
  return hasSession ? "set" : "clear";
}

/**
 * Cookie-namn att leta efter, inklusive NextAuths chunkade varianter
 * (`…session-token.0`, `.1`, …) som används när JWT:n är större än 4 kB.
 * En chunkad session har INGET oindexerat namn alls — letar man bara efter
 * basnamnet ser en sådan session ut som ingen session.
 */
export function sessionCookieCandidates(): string[] {
  const out: string[] = [];
  for (const name of SESSION_COOKIE_NAMES) {
    out.push(name, `${name}.0`);
  }
  return out;
}
