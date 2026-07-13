import { describe, it, expect } from "vitest";
import { mergeEquivalent, mutualIdentityConflict } from "@/scrapers/matching";

/**
 * MERGE-REGELN — den enda som får RADERA en katalogprodukt.
 *
 * Att länka och att merga är inte samma beslut:
 *   LÄNKA: en falsk blockering är dyr (osynlig) → var generös.
 *   MERGA: en falsk sammanslagning är katastrofal (produkten är BORTA) → var strikt.
 *
 * Alla par nedan är VERKLIGA — de kom ur en dry-run mot prod 2026-07-13 där den gamla,
 * generösa matchningen ville merga dem. Varenda "FÅR ALDRIG" hade förstört en riktig produkt.
 */
describe("mergeEquivalent — äkta dubbletter SKA slås ihop", () => {
  it("butikens frasering vs katalogens (användarens Chaos Rising-fall)", () => {
    expect(
      mergeEquivalent(
        "Pokémon, Mega Evolutions, ME04: Chaos Rising, Display / Booster Box",
        "Pokémon TCG: Chaos Rising Booster Box"
      )
    ).toBe(true);
  });

  it("Booster Display = Booster Box (känd synonym)", () => {
    expect(
      mergeEquivalent("Pokémon TCG: Surging Sparks Booster Display", "Pokémon TCG: Surging Sparks Booster Box")
    ).toBe(true);
  });

  it("set-kod och bindestreck är inte identitet", () => {
    expect(
      mergeEquivalent(
        "Pokémon, Scarlet & Violet: Scarlet ex - sv1S, Display / Booster Box (Japansk)",
        "Pokemon Scarlet & Violet: Scarlet ex Booster Box (Japansk)"
      )
    ).toBe(true);
  });
});

describe("mergeEquivalent — olika produkter FÅR ALDRIG slås ihop", () => {
  const MUST_NOT: [string, string, string][] = [
    ["form", "Charizard EX Box", "Charizard ex Premium Collection"],
    ["set", "Gallade XY Premium Checklane Blister", "Silver Tempest: Gallade Premium Checklane Blister"],
    ["antal kort", "EX Deoxys Booster (5 Cards)", "Deoxys Booster Pack"],
    ["antal kort", "Pokémon TCG Sword & Shield - Chilling Reign: Booster", "Chilling Reign Booster (6 Cards)"],
    ["premium-nivå", "Journey Together Checklane Blister", "Journey Together Premium Checklane Blister"],
    ["deluxe", "Black Bolt Deluxe Booster Pack (Japansk)", "Black Bolt - sv11B, 1 booster pack (Japansk)"],
    ["era-ord som identitet", "Scarlet & Violet: Scarlet ex Booster Box", "Scarlet & Violet: Violet ex Booster Box"],
    ["region", "Flareon VMAX Premium Collection US Version", "Flareon VMAX Premium Collection EU Version"],
    ["ultra-premium", "Arceus VSTAR Ultra-Premium Collection", "Arceus VSTAR Premium Collection"],
    ["karaktär", "Ascended Heroes: Mega Meganium ex Box", "Ascended Heroes: Mega Emboar ex Box"],
  ];
  for (const [why, a, b] of MUST_NOT) {
    it(`${why}: "${a.slice(0, 42)}" ≠ "${b.slice(0, 42)}"`, () => {
      expect(mergeEquivalent(a, b)).toBe(false);
    });
  }
});

describe("mergeEquivalent — nakna tal är IDENTITET, inte set-koder", () => {
  it("Base Set ≠ Base Set 2 (dry-runen ville merga dem)", () => {
    expect(mergeEquivalent("Pokémon Mega Evolution Base Set: Booster Pack", "Base Set 2 Booster Pack")).toBe(false);
  });
  it("151 ≠ bas-setet", () => {
    expect(mergeEquivalent("Pokémon TCG: 151 Booster Bundle", "Pokémon TCG: Booster Bundle")).toBe(false);
  });
  it("Series 1 ≠ Series 2", () => {
    expect(
      mergeEquivalent("First Partner Illustration Collection Series 1", "First Partner Illustration Collection Series 2")
    ).toBe(false);
  });
  it("men set-koder MED bokstavsprefix är fortfarande brus", () => {
    expect(mergeEquivalent("Chaos Rising ME04 Booster Box", "Chaos Rising Booster Box")).toBe(true);
  });
});

describe("mutualIdentityConflict — takar, vetar aldrig", () => {
  it("fångar de aktiva 0.9+-fellänkarna (båda sidor har ett eget identitetsord)", () => {
    expect(mutualIdentityConflict("Kanto Friends Mini Tins: Pikachu Tin", "Paldea Friends Mini Tins: Pikachu Tin")).toBe(true);
    expect(mutualIdentityConflict("Generic Love Ball Tin", "Generic Lure Ball Tin")).toBe(true);
    expect(mutualIdentityConflict("Galar Pals Mini Tin Display", "Galar Power Mini Tin Display")).toBe(true);
  });

  it("är TYST för äkta dubbletter — butiken LÄGGER TILL ord, byter inte ut namnet", () => {
    expect(
      mutualIdentityConflict("Pokémon, Mega Evolutions, ME04: Chaos Rising, Display / Booster Box", "Pokémon TCG: Chaos Rising Booster Box")
    ).toBe(false);
    expect(
      mutualIdentityConflict("Pokémon ME02 Phantasmal Flames Checklane", "Phantasmal Flames: Blaziken Premium Checklane Blister")
    ).toBe(false);
  });

  it("KRITISKT: den takar konfidensen, den BLOCKERAR inte — Love Ball hamnar under 0.85 men länken finns kvar", async () => {
    const { matchProduct } = await import("@/scrapers/matching");
    const { normalizeTitle } = await import("@/lib/utils");
    const m = await matchProduct(
      normalizeTitle("Generic Love Ball Tin"),
      [{ id: "X", normalizedTitle: normalizeTitle("Generic Lure Ball Tin"), card: null }],
      "Generic Love Ball Tin"
    );
    expect(m).not.toBeNull(); // länken finns KVAR — ett veto hade gjort den osynlig
    expect(m!.confidence).toBeLessThan(0.85); // men den får inte auto-länkas
  });
});
