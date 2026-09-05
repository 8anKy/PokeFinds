/**
 * Serverfel på anroparens språk: varje nyckel i tabellen måste finnas i BÅDA
 * språkfilerna (annars visar /en/ en rå nyckel), och de texter rutterna faktiskt
 * kastar för forumreglerna och ordfiltret måste stå i tabellen — annars är
 * översättningen tyst borta.
 */
import { describe, expect, it } from "vitest";
import { API_ERROR_KEYS, apiErrorKeyFor } from "@/lib/api-error-i18n";
import en from "../../messages/en.json";
import sv from "../../messages/sv.json";

describe("api-error-i18n", () => {
  it("varje nyckel finns i ApiErrors i båda språken", () => {
    const enKeys = (en as { ApiErrors: Record<string, string> }).ApiErrors;
    const svKeys = (sv as { ApiErrors: Record<string, string> }).ApiErrors;
    for (const key of new Set(Object.values(API_ERROR_KEYS))) {
      expect(enKeys[key], `en.ApiErrors.${key}`).toBeTruthy();
      expect(svKeys[key], `sv.ApiErrors.${key}`).toBeTruthy();
    }
  });

  it("den svenska texten är den som kastas", () => {
    const svKeys = (sv as { ApiErrors: Record<string, string> }).ApiErrors;
    // Stickprov på texter som skrivs i rutterna — matchar de inte ord för ord
    // faller översättningen tyst tillbaka till svenska.
    expect(apiErrorKeyFor("Godkänn forumets regler innan du skriver.")).toBe("forumRules");
    expect(apiErrorKeyFor("Tråden hittades inte.")).toBe("threadNotFound");
    expect(apiErrorKeyFor("Du måste vara inloggad.")).toBe("loginRequired");
    expect(svKeys.threadNotFound).toBe("Tråden hittades inte.");
    expect(apiErrorKeyFor("något helt annat")).toBeNull();
  });
});
