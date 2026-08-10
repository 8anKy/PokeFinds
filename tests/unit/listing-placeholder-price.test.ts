/**
 * Platshållarpris-golvet (isPlaceholderListingPrice): butikers "1 kr"-presale får
 * aldrig bli offer-pris, grafpunkt eller larmtext.
 *
 * Facit = ALLA butiksoffers ≤ 30 kr på sealed i prod 2026-08-10 (13 st). Golvet
 * ska fälla exakt de fyra platshållarna och släppa varje äkta lågpris — testet
 * kodar hela den mätningen, så en framtida "höj golvet lite"-ändring tvingas se
 * vilka ÄKTA priser den börjar äta.
 */
import { describe, expect, it } from "vitest";
import { isPlaceholderListingPrice } from "@/lib/listing-plausibility";

describe("isPlaceholderListingPrice — uppmätt facit 2026-08-10", () => {
  it("fäller de fyra verkliga platshållarna", () => {
    // Kanto Vault 1 kr (presale, verifierat i deras Shopify-JSON: price=100, available=false)
    expect(isPlaceholderListingPrice(100, "BOOSTER_PACK")).toBe(true);
    expect(isPlaceholderListingPrice(100, "BOOSTER_BOX")).toBe(true);
    // Pokétalk 10 kr på en Booster Box (Paradise Dragona)
    expect(isPlaceholderListingPrice(1000, "BOOSTER_BOX")).toBe(true);
  });

  it("släpper varje äkta lågpris i facit", () => {
    // Trick or Trade-minipack: 10 kr hos Dragon's Lair/Spelexperten är ett ÄKTA pris
    expect(isPlaceholderListingPrice(1000, "BOOSTER_PACK")).toBe(false);
    // Shinycards ToT 29 kr, Kanto Vaults japanska packs 29 kr
    expect(isPlaceholderListingPrice(2900, "BOOSTER_PACK")).toBe(false);
    // Card Club-tin 30 kr (länkfel, inte prisfel — golvet dömer inte länkar)
    expect(isPlaceholderListingPrice(3000, "TIN")).toBe(false);
  });

  it("lådskaliga kategorier har högre golv (50 kr), styckvaror lägre (5 kr)", () => {
    for (const cat of ["BOOSTER_BOX", "ETB", "COLLECTION_BOX", "BUNDLE"]) {
      expect(isPlaceholderListingPrice(4999, cat)).toBe(true);
      expect(isPlaceholderListingPrice(5000, cat)).toBe(false);
    }
    for (const cat of ["BOOSTER_PACK", "BLISTER", "TIN", "OTHER", null]) {
      expect(isPlaceholderListingPrice(499, cat)).toBe(true);
      expect(isPlaceholderListingPrice(500, cat)).toBe(false);
    }
  });

  it("null-pris är inget platshållarpris (länk-offer utan pris är legitim)", () => {
    expect(isPlaceholderListingPrice(null, "BOOSTER_BOX")).toBe(false);
    expect(isPlaceholderListingPrice(undefined, null)).toBe(false);
  });
});
