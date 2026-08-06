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

/**
 * Hur länge en session lever UTAN aktivitet. Fönstret är GLIDANDE (se
 * `shouldRenewSession`), så det här är inte "hur länge du får vara inloggad" utan
 * "hur länge en oanvänd enhet får förbli inloggad".
 *
 * ⛔ VAR 30 DYGN ABSOLUT, och det var en riktig bugg: `getServerSession` får ingen
 * `res` i App Router och kan därför inte förnya cookien, och appen läser aldrig
 * `/api/auth/session` (hela poängen med `fo_auth`-hinten). Ingenting förnyade
 * alltså sessionen — ALLA loggades ut exakt 30 dygn efter login hur aktiva de än
 * var. Middleware förnyar nu i stället, utan en enda DB-fråga.
 *
 * ⛔ Ett år, inte "för alltid". En JWT-session går inte att återkalla (det finns
 * ingen sessionstabell att radera ur), så en stulen cookie är giltig tills den går
 * ut. För en användare som öppnar appen någon gång per år är det här omöjligt att
 * skilja från "aldrig", och det lämnar ändå en bortre gräns för en tappad telefon.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Hur gammal token får bli innan middleware skriver om den. Ett dygn: tillräckligt
 * sällan för att kostnaden ska vara noll i praktiken, tillräckligt ofta för att en
 * användare aldrig ska kunna missa fönstret.
 */
export const SESSION_RENEW_AFTER = 60 * 60 * 24;

/** Hinten ska leva exakt lika länge som sessionen — den beskriver ju den. */
export const AUTH_HINT_MAX_AGE = SESSION_MAX_AGE;

/**
 * Ska sessionen skrivas om nu? Ren funktion (sekunder, som JWT:ns `iat`).
 * Saknad/ogiltig `iat` → JA: en token vi inte kan datera ska hellre förnyas en
 * gång för mycket än tystna och logga ut någon.
 */
export function shouldRenewSession(
  issuedAtSeconds: number | undefined,
  nowSeconds: number
): boolean {
  if (typeof issuedAtSeconds !== "number" || !Number.isFinite(issuedAtSeconds)) return true;
  return nowSeconds - issuedAtSeconds >= SESSION_RENEW_AFTER;
}

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

/**
 * Cookie-optionerna en förnyad session måste skrivas med. MÅSTE spegla NextAuths
 * egna defaults exakt — skriver vi t.ex. utan `httpOnly` degraderar vi säkerheten
 * på sessionen, och med fel `path` får webbläsaren TVÅ cookies med samma namn.
 * `secure` härleds ur namnet: `__Secure-`-prefixet KRÄVER det (annars avvisar
 * webbläsaren cookien tyst), och utan prefix körs vi på http i dev.
 */
export function sessionCookieOptions(cookieName: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: cookieName.startsWith("__Secure-"),
    maxAge: SESSION_MAX_AGE,
  };
}
