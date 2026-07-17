import { describe, it, expect } from "vitest";
import { linkSimilarity } from "../../scripts/cm-link-mismatch-report";

const T = 0.34; // rapportens tröskel

// Fångar FEL sealed-länk (title↔CM-namn). Måste flagga äkta fel MEN inte de falska positiva
// som en för aggressiv normalisering gav (set-namn strippades → tomma tokens → sim 0).
describe("linkSimilarity — CM-länk-missmatch", () => {
  it("FLAGGAR äkta fellänkar (låg likhet)", () => {
    // Ägarens fynd 2026-07-17:
    expect(linkSimilarity("2022 Water Stacking Tin", "Tapu Lele Enhanced 2-Pack Blister")).toBeLessThan(T);
    expect(linkSimilarity("Meowth VMAX Special Collection", "Pitch Black: Tyrantrum Premium Checklane Blister")).toBeLessThan(T);
    // Venusaur→Surfing Pikachu-klassen (om den vore sealed→sealed):
    expect(linkSimilarity("Red & Blue Collections: Venusaur EX Collection", "Charizard EX Box")).toBeLessThan(T);
  });

  it("FLAGGAR INTE korrekta länkar (falska positiva från tidigare aggressiv norm)", () => {
    expect(linkSimilarity("XY Booster Box", "XY Booster Box")).toBeGreaterThanOrEqual(T);
    expect(linkSimilarity("Pokemon Scarlet & Violet: Violet ex Booster Pack (Japansk)", "Violet ex Booster")).toBeGreaterThanOrEqual(T);
    expect(linkSimilarity("Pokemon Scarlet & Violet: Scarlet ex Booster Box (Japansk)", "Scarlet ex Booster Box")).toBeGreaterThanOrEqual(T);
    expect(linkSimilarity("Pokémon Scarlet & Violet: 151 Booster Pack (Japansk)", "Pokémon Card 151 Booster")).toBeGreaterThanOrEqual(T);
    expect(linkSimilarity("Red & Blue Collections: Venusaur EX Collection", "Red & Blue Collections: Venusaur EX Collection")).toBeGreaterThanOrEqual(T);
    // reprint/generisk: Poké Ball Tin 2026 → Generic Poké Ball Tin (medvetet länkad)
    expect(linkSimilarity("Pokemon TCG Poke Ball Tin 2026", "Generic Poké Ball Tin")).toBeGreaterThanOrEqual(T);
  });
});
