/**
 * Personlig inbjudningslänk (2026-10-01): foilio.se/i/<kod> på varje delningsbild.
 *
 * Länken är ÅTERANVÄNDBAR — till skillnad från engångskoderna i /mer/bjud-in.
 * Varje ny användare som skapar konto via den blir en vanlig Invite-rad
 * (`personal = true`), så belöningen (3 vänner ⇒ 1 månad Pro, en gång) och
 * återbesöksgrinden gäller oförändrat. Se services/invites.ts.
 *
 * Vägen: middleware fångar /i/<kod>, sätter en server-cookie i 30 dygn och skickar
 * besökaren till startsidan (ägarbeslut: titta runt först). Registreringen — både
 * formuläret och Google/Apple — läser cookien. Samma mönster som kreatörslänken
 * (lib/creator-ref.ts), och av samma skäl:
 * ⛔ COOKIEN SÄTTS AV SERVERN (WebKit kapar `document.cookie` till 7 dygn).
 * ⛔ INGEN DB I MIDDLEWARE — koden valideras först vid registreringen.
 */

export const INVITE_COOKIE = "fo_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Utan förväxlingsbara tecken (0/o, 1/l/i) — koden ska gå att skriva av från en bild. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const INVITE_CODE_LENGTH = 7;

export function generateInviteCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Kanonisk form, eller null. Versaler tillåts (avskrivet för hand), allt annat
 * fäller koden — till skillnad från kreatörskoden kastas inga tecken: en
 * personlig kod är slumpad, så "nästan rätt" är en annan persons kod.
 */
export function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9]{4,12}$/.test(code) ? code : null;
}

/** /i/<kod> (efter avskalat locale-prefix) → koden, annars null. */
export function inviteCodeFromPath(path: string): string | null {
  const m = /^\/i\/([^/]+)\/?$/.exec(path);
  return m ? normalizeInviteCode(m[1]) : null;
}

/** Det som trycks på bilden och kopieras: utan protokoll, kort nog att skriva av. */
export function inviteLinkLabel(code: string): string {
  return `foilio.se/i/${code}`;
}

export function inviteLinkUrl(code: string): string {
  return `https://${inviteLinkLabel(code)}`;
}
