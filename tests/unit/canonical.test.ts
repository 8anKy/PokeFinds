import { describe, it, expect } from "vitest";
import { localeUrl, alternatesFor } from "@/lib/canonical";

// Vakt mot en FELAKTIG kanonisk URL, inte mot en saknad. Sajten låg utan kanonisk
// URL fram till 2026-08-08 och Google valde då marcustheatres.com som kanonisk för
// /produkter — men en kanonisk URL som pekar på FEL egen sida är lika illa: den
// dirigerar aktivt bort indexeringen. Reglerna som kan glida är exakt två:
// sv ligger på rot (localePrefix "as-needed") och en ligger på /en.

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

describe("canonical", () => {
  it("lägger INGET prefix på svenska (standardspråket)", () => {
    expect(localeUrl("sv", "/produkter")).toBe(`${BASE}/produkter`);
  });

  it("lägger /en-prefix på engelska", () => {
    expect(localeUrl("en", "/produkter")).toBe(`${BASE}/en/produkter`);
  });

  it("hanterar rotvägen utan att tappa avslutande slash", () => {
    expect(localeUrl("sv", "/")).toBe(`${BASE}/`);
    expect(localeUrl("en", "/")).toBe(`${BASE}/en`);
  });

  it("behåller dynamiska segment", () => {
    expect(localeUrl("sv", "/sets/sv1")).toBe(`${BASE}/sets/sv1`);
    expect(localeUrl("en", "/produkter/charizard-ex")).toBe(
      `${BASE}/en/produkter/charizard-ex`
    );
  });

  it("kanonisk URL följer det språk som renderas, aldrig standardspråket", () => {
    // ⛔ Om engelska sidor pekade kanoniskt på den svenska versionen skulle den
    // engelska aldrig indexeras — det är hreflang som knyter ihop dem, inte canonical.
    expect(alternatesFor("en", "/marknad")?.canonical).toBe(`${BASE}/en/marknad`);
    expect(alternatesFor("sv", "/marknad")?.canonical).toBe(`${BASE}/marknad`);
  });

  it("deklarerar båda språken + x-default på svenska", () => {
    const langs = alternatesFor("sv", "/priser")?.languages;
    expect(langs).toEqual({
      sv: `${BASE}/priser`,
      en: `${BASE}/en/priser`,
      "x-default": `${BASE}/priser`,
    });
  });
});
