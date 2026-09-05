/**
 * Undersidelistan styr TVÅ saker som måste vara i takt: `SiteHeaderGate` döljer
 * logotyphuvudet på mobil, och sidan renderar `SubpageHeader` i stället. En rutt
 * som finns i det ena men inte det andra ger dubbel chrome (eller ingen bakåtväg).
 * Testet vaktar listan mot de sidor som faktiskt använder huvudet.
 */
import { describe, expect, it } from "vitest";
import { isSubpageRoute } from "@/lib/subpage-routes";

describe("isSubpageRoute", () => {
  it("undersidor med SubpageHeader räknas", () => {
    for (const p of [
      "/bevakningar",
      "/installningar",
      "/gradera",
      "/admin",
      "/priser",
      "/kontakt",
      "/forum/sparade",
      "/forum/ny",
      "/forum/g/allmant",
      "/forum/t/abc123",
      "/mer/utmarkelser",
      "/mer/bjud-in",
      "/meddelanden/conv1",
      "/produkter/30th-celebration-elite-trainer-box",
      "/sets/sv10",
    ]) {
      expect(isSubpageRoute(p), p).toBe(true);
    }
  });

  it("flikarnas rotsidor och listor behåller logotyphuvudet", () => {
    for (const p of ["/", "/produkter", "/samling", "/skanna", "/forum", "/meddelanden", "/mer", "/sets", "/marknad"]) {
      expect(isSubpageRoute(p), p).toBe(false);
    }
  });

  it("tål trailing slash, query och tomt", () => {
    expect(isSubpageRoute("/bevakningar/")).toBe(true);
    expect(isSubpageRoute("/forum/t/abc?x=1")).toBe(true);
    expect(isSubpageRoute("/forum/t/")).toBe(false);
    expect(isSubpageRoute(null)).toBe(false);
    expect(isSubpageRoute("")).toBe(false);
  });
});
