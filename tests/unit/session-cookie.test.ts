import { describe, it, expect } from "vitest";
import {
  authHintAction,
  sessionCookieCandidates,
  AUTH_HINT_COOKIE,
  AUTH_HINT_MAX_AGE,
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
    expect(AUTH_HINT_MAX_AGE).toBe(30 * 24 * 3600);
  });
});
