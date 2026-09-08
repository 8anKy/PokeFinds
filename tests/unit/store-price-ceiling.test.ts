/**
 * Övre prisgränsen gäller BARA marknadsplatser (2026-09-08).
 *
 * På Tradera betyder "3× Cardmarket" nästan alltid en LOT eller en felmatchad
 * premiumvariant. I en svensk BUTIK betyder det bara att butiken är dyr — Cardmarket
 * är EU-brett LÄGSTA annonspris, svensk detaljhandel har moms, frakt och marginal.
 * Ägaren: "många av butikerna vi lagt till ligger 2–3× Cardmarket, så är det bara."
 *
 * Taket fällde därför ÄKTA butiksannonser, TYST, med loggraden "trolig lot/felmatch":
 * 4 av Cardshop Swedens 13 sealed försvann så.
 */
import { describe, expect, it } from "vitest";
import { isPlausiblePriceFor } from "@/scrapers/matching";

const CM = 60_253; // Inferno X Booster Box, facit 602,53 kr

describe("övre gränsen: marknadsplats vs butik", () => {
  it("BUTIK: 3,6× Cardmarket är ett pris, inte en felmatch", () => {
    expect(isPlausiblePriceFor("BOOSTER_BOX", CM, 219_000, "store")).toBe(true);
  });

  it("MARKNADSPLATS: samma pris är fortfarande en trolig lot", () => {
    expect(isPlausiblePriceFor("BOOSTER_BOX", CM, 219_000, "marketplace")).toBe(false);
  });

  it("de fyra Cardshop Sweden-boxarna som föll tyst släpps nu igenom", () => {
    for (const [price, ref] of [[219_000, 60_253], [119_900, 44_528], [119_900, 47_988], [169_900, 64_505]]) {
      expect(isPlausiblePriceFor("BOOSTER_BOX", ref, price, "store"), `${price} mot ${ref}`).toBe(true);
    }
  });

  // ⛔ UNDRE gränsen gäller BÅDA: ett pris långt under ett pålitligt facit är ett
  //    öppnat exemplar eller en felmatchning oavsett var det står.
  it("undre gränsen rörs inte — 149 kr på en 2 333 kr-box fälls i båda", () => {
    expect(isPlausiblePriceFor("BOOSTER_BOX", 233_300, 14_900, "store")).toBe(false);
    expect(isPlausiblePriceFor("BOOSTER_BOX", 233_300, 14_900, "marketplace")).toBe(false);
  });

  it("default är marknadsplats — befintliga anropare ändrar inte beteende", () => {
    expect(isPlausiblePriceFor("BOOSTER_BOX", CM, 219_000)).toBe(false);
  });

  it("obevakade kategorier och saknat facit är oförändrat rimliga", () => {
    expect(isPlausiblePriceFor("BOOSTER_PACK", CM, 219_000, "marketplace")).toBe(true);
    expect(isPlausiblePriceFor("BOOSTER_BOX", null, 219_000, "marketplace")).toBe(true);
  });
});
