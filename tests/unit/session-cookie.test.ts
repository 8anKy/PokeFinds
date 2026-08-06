import { describe, it, expect } from "vitest";
import { encode, decode } from "next-auth/jwt";
import {
  authHintAction,
  sessionCookieCandidates,
  sessionCookieOptions,
  shouldRenewSession,
  AUTH_HINT_COOKIE,
  AUTH_HINT_MAX_AGE,
  SESSION_MAX_AGE,
  SESSION_RENEW_AFTER,
} from "@/lib/session-cookie";

describe("auth-hint-synk mot sessionscookien", () => {
  it("skriver ingenting när hinten redan stämmer", () => {
    expect(authHintAction(true, true)).toBe("none");
    expect(authHintAction(false, false)).toBe("none");
  });

  // Det HÄR är buggen: WebKit kapar document.cookie till 7 dygn, så hinten dog
  // medan sessionen levde → AuthHintGate slängde iPhone-användaren till login.
  it("återställer hinten när sessionen lever men hinten kapats bort", () => {
    expect(authHintAction(true, false)).toBe("set");
  });

  it("rensar hinten när sessionen är borta", () => {
    expect(authHintAction(false, true)).toBe("clear");
  });

  // En JWT > 4 kB chunkas av NextAuth och har då INGET oindexerat namn alls —
  // letar man bara efter basnamnet ser en sådan session ut som ingen session,
  // och synken hade rensat hinten för en fullt inloggad användare.
  it("känner igen både säkra, osäkra och chunkade cookie-namn", () => {
    const names = sessionCookieCandidates();
    expect(names).toContain("next-auth.session-token");
    expect(names).toContain("__Secure-next-auth.session-token");
    expect(names).toContain("next-auth.session-token.0");
    expect(names).toContain("__Secure-next-auth.session-token.0");
  });

  it("hinten heter samma sak som klientsidan skriver och lever lika länge som sessionen", () => {
    expect(AUTH_HINT_COOKIE).toBe("fo_auth");
    expect(AUTH_HINT_MAX_AGE).toBe(SESSION_MAX_AGE);
  });
});

describe("glidande session", () => {
  const now = 1_800_000_000;

  it("skriver inte om en färsk token", () => {
    expect(shouldRenewSession(now - 60, now)).toBe(false);
    expect(shouldRenewSession(now - (SESSION_RENEW_AFTER - 1), now)).toBe(false);
  });

  it("skriver om när token passerat förnyelsegränsen", () => {
    expect(shouldRenewSession(now - SESSION_RENEW_AFTER, now)).toBe(true);
    expect(shouldRenewSession(now - 90 * 24 * 3600, now)).toBe(true);
  });

  // En token vi inte kan datera ska hellre förnyas en gång för mycket än tystna
  // och logga ut någon — utloggning är den dyra utgången här, inte en extra skrivning.
  it("förnyar när iat saknas eller är skräp", () => {
    expect(shouldRenewSession(undefined, now)).toBe(true);
    expect(shouldRenewSession(NaN, now)).toBe(true);
  });

  // ⛔ Fönstret är GLIDANDE. Var det absolut loggades alla ut efter maxAge oavsett
  // aktivitet — det var buggen. Ett år är "aldrig" för en användare som öppnar
  // appen, men lämnar ändå en bortre gräns för en tappad telefon.
  it("inaktivitetsfönstret är ett år", () => {
    expect(SESSION_MAX_AGE).toBe(365 * 24 * 3600);
    expect(SESSION_RENEW_AFTER).toBe(24 * 3600);
  });

  /**
   * ⛔ FÖRNYELSEN FÅR INTE TAPPA NYTTOLASTEN. Middleware skickar tillbaka exakt den
   * token `getToken` gav (inklusive `iat`/`exp`/`jti`) in i `encode`. Tappade den
   * `id`/`role`/`planTier` hade varje inloggad förlorat sin roll och sin Pro efter
   * ett dygn — tyst, och bara i produktion. Testet kör den RIKTIGA encode/decode
   * från next-auth, så det failar också om biblioteket byter kontrakt (v5 kräver
   * t.ex. en `salt`-parameter).
   */
  it("bevarar hela nyttolasten och ger en färsk utgång", async () => {
    const secret = "test-secret-som-bara-anvands-har-0123456789";
    // Rollen/planen är Prisma-enums i JWT-augmenteringen (src/lib/auth.ts), inte
    // strängar — `as const` håller testet ärligt mot den riktiga typen.
    const original = {
      id: "usr_1",
      role: "ADMIN" as const,
      planTier: "PREMIUM" as const,
      bonusProUntil: null,
      onboardingCompleted: true,
      refreshedAt: 1_700_000_000_000,
      iat: 1_700_000_000,
      exp: 1_700_086_400,
      jti: "gammal-jti",
    };

    const cookie = await encode({ token: original, secret, maxAge: SESSION_MAX_AGE });
    const renewed = (await decode({ token: cookie, secret })) as Record<string, unknown>;

    expect(renewed.id).toBe("usr_1");
    expect(renewed.role).toBe("ADMIN");
    expect(renewed.planTier).toBe("PREMIUM");
    expect(renewed.onboardingCompleted).toBe(true);
    // refreshedAt styr DB-omläsningen i jwt-callbacken — nollställs den börjar varje
    // sidladdning läsa User ur Neon igen.
    expect(renewed.refreshedAt).toBe(1_700_000_000_000);

    const nowSec = Math.floor(Date.now() / 1000);
    expect(renewed.iat as number).toBeGreaterThan(original.iat);
    expect(renewed.exp as number).toBeGreaterThan(nowSec + SESSION_MAX_AGE - 60);
    // Färsk token → middleware låter den vara tills förnyelsegränsen passerats.
    expect(shouldRenewSession(renewed.iat as number, nowSec)).toBe(false);
  });

  // ⛔ Måste spegla NextAuths egna defaults. Fel `path` ger TVÅ cookies med samma
  // namn; utan httpOnly degraderas sessionen till läsbar för skript.
  it("skriver med NextAuths egna cookie-optioner", () => {
    expect(sessionCookieOptions("next-auth.session-token")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: SESSION_MAX_AGE,
    });
    // __Secure- KRÄVER secure — utan den avvisar webbläsaren cookien TYST.
    expect(sessionCookieOptions("__Secure-next-auth.session-token").secure).toBe(true);
  });
});
