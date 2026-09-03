import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import sv from "../../messages/sv.json";
import { AUTH_ERROR_FALLBACK_SV, authError, type AuthErrorCode } from "@/lib/auth-errors";

/**
 * Auth-routerna svarar med en KOD; klienten översätter den via
 * `Auth.serverErrors`. Saknas nyckeln faller klienten tillbaka på serverns
 * `error`, som ALLTID är svensk — dvs. exakt felet vi lagade (svenskt
 * felmeddelande i det engelska formuläret, uppmätt i Android-appen 2026-09-03).
 * En ny kod utan översättning är därför en TYST regression: inget kastar, allt
 * "fungerar", och bara den engelska användaren ser skillnaden.
 */
const CODES = Object.keys(AUTH_ERROR_FALLBACK_SV) as AuthErrorCode[];

describe("auth-felkoder", () => {
  it("har en översättning i BÅDA språken för varje kod", () => {
    const missingSv = CODES.filter((c) => !(sv.Auth.serverErrors as Record<string, string>)[c]);
    const missingEn = CODES.filter((c) => !(en.Auth.serverErrors as Record<string, string>)[c]);
    expect(missingSv, "saknas i messages/sv.json").toEqual([]);
    expect(missingEn, "saknas i messages/en.json").toEqual([]);
  });

  it("har inga översättningar utan kod (döda nycklar drar isär katalogerna)", () => {
    expect(Object.keys(sv.Auth.serverErrors).sort()).toEqual([...CODES].sort());
    expect(Object.keys(en.Auth.serverErrors).sort()).toEqual([...CODES].sort());
  });

  it("den engelska texten är faktiskt engelsk, inte kopierad svenska", () => {
    for (const code of CODES) {
      const e = (en.Auth.serverErrors as Record<string, string>)[code];
      expect(e, code).not.toBe((sv.Auth.serverErrors as Record<string, string>)[code]);
      // Svenska tecken i den engelska katalogen = någon klistrade in fel sträng.
      expect(e, code).not.toMatch(/[åäöÅÄÖ]/);
    }
  });

  it("den svenska reserven i koden och i katalogen säger samma sak", () => {
    for (const code of CODES) {
      expect((sv.Auth.serverErrors as Record<string, string>)[code], code).toBe(
        AUTH_ERROR_FALLBACK_SV[code]
      );
    }
  });

  it("authError bär både kod och reservtext, och `field` bara när den anges", () => {
    expect(authError("rateLimited")).toEqual({
      code: "rateLimited",
      error: AUTH_ERROR_FALLBACK_SV.rateLimited,
    });
    expect(authError("nameTaken", "name")).toEqual({
      code: "nameTaken",
      error: AUTH_ERROR_FALLBACK_SV.nameTaken,
      field: "name",
    });
  });

  it("lösenordsögats etikett finns i båda språken (den var hårdkodad svensk)", () => {
    expect(sv.Auth.showPassword).toBeTruthy();
    expect(en.Auth.showPassword).toBeTruthy();
    expect(en.Auth.showPassword).not.toMatch(/[åäöÅÄÖ]/);
    expect(en.Auth.hidePassword).not.toMatch(/[åäöÅÄÖ]/);
  });
});
