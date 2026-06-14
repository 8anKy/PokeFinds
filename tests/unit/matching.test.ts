/**
 * Tester för fuzzy-matchning i src/scrapers/matching.ts.
 * Prisma mockas bort — vi testar bara de rena funktionerna
 * scoreSimilarity och extractSetNumber.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { extractSetNumber, scoreSimilarity } from "@/scrapers/matching";

describe("scoreSimilarity", () => {
  it("identiska titlar ger 1", () => {
    expect(scoreSimilarity("Charizard ex 199/165", "Charizard ex 199/165")).toBe(1);
  });

  it("identiska efter normalisering ger 1 (skiftläge/specialtecken ignoreras)", () => {
    expect(scoreSimilarity("Pokémon TCG: Booster Box", "pokemon tcg booster box")).toBe(1);
  });

  it("helt olika strängar ger ungefär 0", () => {
    expect(scoreSimilarity("xyzqw", "abcde")).toBeLessThan(0.1);
  });

  it("liknande titlar ger hög poäng", () => {
    const score = scoreSimilarity(
      "Surging Sparks Elite Trainer Box",
      "Pokemon Surging Sparks Elite Trainer Box EN"
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it("delvis överlappande titlar ger mellanpoäng", () => {
    const score = scoreSimilarity("Surging Sparks Booster Box", "Surging Sparks Booster Pack");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("tom sträng ger 0", () => {
    expect(scoreSimilarity("", "Pikachu")).toBe(0);
    expect(scoreSimilarity("Pikachu", "")).toBe(0);
    expect(scoreSimilarity("!!!", "Pikachu")).toBe(0); // normaliseras till tomt
  });

  it("är symmetrisk", () => {
    const a = "Charizard ex Super Premium Collection";
    const b = "Charizard Premium Collection Box";
    expect(scoreSimilarity(a, b)).toBeCloseTo(scoreSimilarity(b, a), 10);
  });
});

describe("extractSetNumber", () => {
  it("extraherar setnummer som num/total", () => {
    expect(extractSetNumber("Pikachu 25/102 Holo")).toEqual({ num: 25, total: 102 });
  });

  it("hanterar mellanslag runt snedstrecket", () => {
    expect(extractSetNumber("Mew 151 / 165")).toEqual({ num: 151, total: 165 });
  });

  it("returnerar null när setnummer saknas", () => {
    expect(extractSetNumber("Booster Box Surging Sparks")).toBeNull();
  });

  it("matchar inte fler än tre siffror", () => {
    expect(extractSetNumber("artikel 1234/5678")).toBeNull();
  });

  it("hanterar nummer med inledande nollor", () => {
    expect(extractSetNumber("Eevee 025/102")).toEqual({ num: 25, total: 102 });
  });
});
