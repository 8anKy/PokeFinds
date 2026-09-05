/**
 * OMDIRIGERINGAR I politeFetch — varför vi följer dem själva.
 *
 * 2026-09-05: goblinen.com svarade 301 → www.goblinen.com på `/products/<handle>.js`,
 * och Nodes fetch stryker `cookie` när origin byts. Vår `localization=SE`-pinne
 * försvann på vägen och GitHub-runnern (US) fick Shopify Markets ex-moms-pris:
 * 639,20 kr för en ETB som kostar 799 kr, på alla fem bevakade Goblinen-länkar.
 * Regeln som räddar cookien måste samtidigt ALDRIG låta den följa med till en
 * annan domän.
 */
import { describe, expect, it } from "vitest";
import { isSameSiteRedirect } from "@/scrapers/http";

const u = (s: string) => new URL(s);

describe("isSameSiteRedirect", () => {
  it("apex ↔ www är samma sajt — cookien ska överleva (Goblinen-fallet)", () => {
    expect(isSameSiteRedirect(u("https://goblinen.com/products/x.js"), u("https://www.goblinen.com/products/x.js"))).toBe(true);
    expect(isSameSiteRedirect(u("https://www.dragonslair.se/a"), u("https://dragonslair.se/a"))).toBe(true);
  });

  it("underdomäner på samma registrerbara domän räknas som samma sajt", () => {
    expect(isSameSiteRedirect(u("https://shop.example.se/a"), u("https://example.se/b"))).toBe(true);
    expect(isSameSiteRedirect(u("https://example.se/a"), u("https://cdn.example.se/b"))).toBe(true);
  });

  it("⛔ en annan domän får aldrig våra headers", () => {
    expect(isSameSiteRedirect(u("https://goblinen.com/a"), u("https://goblinen.com.evil.example/a"))).toBe(false);
    expect(isSameSiteRedirect(u("https://goblinen.com/a"), u("https://shopify.com/a"))).toBe(false);
    expect(isSameSiteRedirect(u("https://goblinen.com/a"), u("https://notgoblinen.com/a"))).toBe(false);
  });

  it("bara http(s) — en omdirigering till ett annat schema följs inte med headers", () => {
    expect(isSameSiteRedirect(u("https://goblinen.com/a"), u("ftp://goblinen.com/a"))).toBe(false);
  });
});
