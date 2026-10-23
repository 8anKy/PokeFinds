import { describe, expect, it } from "vitest";
import { patternExpansion } from "@/lib/catalog-gap-identity";
import { normalizePrinting } from "@/lib/import-normalize";
import { listingFitsVariant, variantInTitle } from "@/lib/print-variant";

describe("mönster-expansioner (Ascended Heroes, MEGA Dream ex)", () => {
  it("bollnamnet står i versionen, inte i expansionen — CT:s stavfel inräknade", () => {
    const e = "Ascended Heroes - Ball & Rocket Reverse Holo";
    expect(patternExpansion(e, "Love Ball Reverse Holo")).toEqual({ set: "Ascended Heroes", label: "Love Ball Reverse Holo" });
    expect(patternExpansion(e, "Reverse Friend Ball Holo")).toEqual({ set: "Ascended Heroes", label: "Friend Ball Reverse Holo" });
    expect(patternExpansion(e, "PoKé Ball Reverse Holo")?.label).toBe("Poké Ball Reverse Holo");
    expect(patternExpansion(e, "Reverse Rocket Holo")?.label).toBe("Rocket Reverse Holo");
    expect(patternExpansion(e, "Dusk Ball Reverse Holo")?.label).toBe("Dusk Ball Reverse Holo");
  });
  it("Energy-mönstret är setets vanliga reverse holo", () => {
    expect(patternExpansion("MEGA Dream ex - Energy Reverse Holo", "Energy Reverse Holo")).toEqual({ set: "MEGA Dream ex", label: "Reverse Holo" });
    expect(patternExpansion("Ascended Heroes - Energy Reverse Holo", "Reverse Energy Holo")?.label).toBe("Reverse Holo");
  });
  it("gamla bollexpansioner som förut, okänt mönster avstås", () => {
    expect(patternExpansion("Prismatic Evolutions - Master Ball Reverse Holo", null)).toEqual({ set: "Prismatic Evolutions", label: "Master Ball Reverse Holo" });
    expect(patternExpansion("Ascended Heroes - Ball & Rocket Reverse Holo", "Holo Rare")).toBeNull();
    expect(patternExpansion("Ascended Heroes", "Love Ball Reverse Holo")).toBeNull();
  });
});

describe("annonstitlar för de nya mönstren", () => {
  it("boll och Rocket känns igen", () => {
    expect(variantInTitle("Erika's Oddish Love Ball reverse holo Ascended Heroes")).toBe("Love Ball Reverse Holo");
    expect(variantInTitle("Yanma 002 Quick Ball MEGA Dream")).toBe("Quick Ball Reverse Holo");
    expect(variantInTitle("Team Rocket's Mewtwo ex rocket reverse holo")).toBe("Rocket Reverse Holo");
  });
  it("Team Rocket i kortnamnet är inget Rocket-mönster", () => {
    expect(variantInTitle("Team Rocket's Mewtwo ex 081 Destined Rivals")).toBeNull();
    expect(listingFitsVariant(null, "Team Rocket's Mewtwo ex 081 Destined Rivals")).toBe(true);
    expect(listingFitsVariant("Rocket Reverse Holo", "Team Rocket's Mewtwo ex 081")).toBe(false);
  });
  it("trainerkortet Quick Ball är inte mönstret", () => {
    expect(variantInTitle("Quick Ball 237 Fusion Strike", "Quick Ball")).toBeNull();
  });
  it("importens tryckningsfält", () => {
    expect(normalizePrinting("Dusk Ball")).toBe("Dusk Ball Reverse Holo");
    expect(normalizePrinting("Rocket Reverse")).toBe("Rocket Reverse Holo");
    expect(normalizePrinting("Poké Ball")).toBe("Poké Ball Reverse Holo");
  });
});

describe("förseglat med 'ball' i namnet är ingen variant", () => {
  it("Poké Ball Tin / Love Ball Tin matchar sin sealed-produkt", async () => {
    const { matchProduct } = await import("@/scrapers/matching");
    const { normalizeTitle } = await import("@/lib/utils");
    for (const t of ["Pokémon TCG Poké Ball Tin 2024", "Generic Love Ball Tin"]) {
      const m = await matchProduct(normalizeTitle(t), [{ id: "X", normalizedTitle: normalizeTitle(t), card: null, variantLabel: null }], t);
      expect(m?.productId ?? (m as { id?: string } | null)?.id ?? null).not.toBeNull();
    }
  });
});
