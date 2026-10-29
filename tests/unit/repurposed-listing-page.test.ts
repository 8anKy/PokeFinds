import { describe, expect, it } from "vitest";
import { isRepurposedListingPage } from "@/scrapers/matching";

/**
 * ÅTERANVÄND BUTIKSSIDA (2026-10-29). Speltrollet gjorde sin Chaos Rising Booster
 * Bundle-sida till "30th Celebration Ultra Premium Collection Box - Day" (samma URL,
 * bundlens streckkod kvar) och Discord postade "Mega Evolution Booster Bundle · 3 490 kr".
 *
 * Fallen nedan är RIKTIGA bundna butikslänkar ur mätningen mot prod (2 107 st) —
 * productsConflict flaggade dem men de är korrekta eller bara nära grannar, och får
 * ALDRIG lossas automatiskt (lossningen raderar offern).
 */
describe("isRepurposedListingPage", () => {
  it("fångar sidan som gjorts om till en annan vara", () => {
    expect(
      isRepurposedListingPage("Pokemon 30th Celebration Ultra Premium Collection Box - Day", "Mega Evolution Booster Bundle", "EN")
    ).toBe(true);
  });

  it.each([
    ["Pokemon - Kleavor V Star Premium Collection", "Kleavor VSTAR Premium Collection"],
    ["Astral Radiance Checklane Blister Totodile", "Astral Radiance: Feraligatr Premium Checklane Blister"],
    ["Pokémon 30th Celebration Futuristic Box", "30th Celebration JP Futuristic Box"],
    ["Pokémon, SV4: Paradox Rift, LITEN Booster Box [Innehåller 18 boosters]", "Paradox Rift Booster Box"],
    [
      "Pokémon TCG: Temporal Forces Elite Trainer Box (Scarlet & Violet) - Iron Leaves Elite Trainer box (Grøn) / Brugtmoms",
      "Temporal Forces Walking Wake Elite Trainer Box",
    ],
    ["Pokemon 30th Celebration Ultra Premium Collection Box - Night", "Pokémon 30th Celebration Ultra Premium Collection (ENG)"],
  ])("lossar inte en nära granne: %s", (listing, product) => {
    expect(isRepurposedListingPage(listing, product, "EN")).toBe(false);
  });
});
