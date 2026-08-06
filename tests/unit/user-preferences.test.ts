import { describe, it, expect } from "vitest";
import { favoriteSetIds } from "@/lib/user-preferences";

describe("favoriteSetIds", () => {
  it("läser favoritseten från onboardingen", () => {
    expect(favoriteSetIds({ favoriteSets: ["sv8", "sv9"], budget: "medium" })).toEqual([
      "sv8",
      "sv9",
    ]);
  });

  // Kolumnen är otypad JSON skriven av flera versioner av onboardingen. Kastar
  // den här funktionen sänks HELA katalogfeeden för den användaren — bara för
  // inloggade, bara i produktion.
  it("kastar aldrig på trasig eller saknad data", () => {
    expect(favoriteSetIds(null)).toEqual([]);
    expect(favoriteSetIds(undefined)).toEqual([]);
    expect(favoriteSetIds({})).toEqual([]);
    expect(favoriteSetIds({ favoriteSets: null })).toEqual([]);
    expect(favoriteSetIds({ favoriteSets: "sv8" })).toEqual([]);
    expect(favoriteSetIds("nonsens")).toEqual([]);
    expect(favoriteSetIds(42)).toEqual([]);
  });

  it("sållar bort tomma och icke-strängar utan att tappa resten", () => {
    expect(favoriteSetIds({ favoriteSets: ["sv8", "", null, 7, "  ", "sv9"] })).toEqual([
      "sv8",
      "sv9",
    ]);
  });
});
