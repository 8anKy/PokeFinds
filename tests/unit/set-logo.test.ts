import { describe, expect, it } from "vitest";
import { isRealSetLogo, splitSetCode } from "@/lib/set-logo";

describe("isRealSetLogo", () => {
  it("godtar riktiga loggor", () => {
    expect(isRealSetLogo("/set-logos/jp/XY7.png")).toBe(true);
    expect(isRealSetLogo("https://images.pokemontcg.io/sv8/logo.png")).toBe(true);
    expect(isRealSetLogo("https://images.tcggo.com/tcggo/storage/48295/tag-bolt.png")).toBe(true);
  });
  it("avvisar kort, produktfoton och ritade brickor", () => {
    expect(isRealSetLogo(null)).toBe(false);
    expect(isRealSetLogo("/set-logos/generated/abc.webp")).toBe(false);
    expect(isRealSetLogo("https://cdn.shopify.com/s/files/1/x.jpg")).toBe(false);
    expect(isRealSetLogo("https://images.tcggo.com/tcggo/storage/1/dustox-lv8-dp1-1-space-time-creation.webp")).toBe(false);
  });
});

describe("splitSetCode", () => {
  it("delar namn och kod", () => {
    expect(splitSetCode("Bandit Ring (XY7)")).toEqual({ title: "Bandit Ring", code: "XY7" });
    expect(splitSetCode("Mewtwo vs Genesect Deck Kit (Genesect) (MGg)")).toEqual({ title: "Mewtwo vs Genesect Deck Kit (Genesect)", code: "MGg" });
    expect(splitSetCode("Pitch Black")).toEqual({ title: "Pitch Black", code: null });
  });
});
