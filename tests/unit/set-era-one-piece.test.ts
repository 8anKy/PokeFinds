import { describe, it, expect } from "vitest";
import { eraRank, onePieceGroup, setEra } from "../../src/lib/set-era";

describe("One Piece-set grupperas på typ, aldrig på Pokémon-era (2026-11-10)", () => {
  it("koden avgör gruppen", () => {
    expect(onePieceGroup("OP-16", "The Time of Battle")).toBe("Booster Sets");
    expect(onePieceGroup("EB05", "Heroines Edition Vol.2")).toBe("Extra Boosters");
    expect(onePieceGroup("PRB-02", "One Piece Card The Best Vol.2")).toBe("Premium Boosters");
    expect(onePieceGroup("ST32", "GREEN Roronoa Zoro")).toBe("Starter Decks");
    expect(onePieceGroup("OP-P", "Promos")).toBe("Other");
  });
  it("utan kod: namnet som reserv", () => {
    expect(onePieceGroup(null, "Ultra Deck: The Three Brothers")).toBe("Starter Decks");
    expect(onePieceGroup(null, "One Piece Card The Best")).toBe("Premium Boosters");
    expect(onePieceGroup(null, "Romance Dawn")).toBe("Other");
  });
  it("⛔ ett One Piece-set med släppdatum blir aldrig en Pokémon-era", () => {
    const era = setEra({ name: "The Time of Battle", language: "EN", series: "One Piece", releaseDate: "2026-03-01", game: "ONE_PIECE", code: "OP-16" });
    expect(era).toBe("Booster Sets");
    expect(setEra({ name: "Romance Dawn", language: "EN", series: "One Piece", releaseDate: "2023-07-01", game: "ONE_PIECE" })).toBe("Other");
  });
  it("Pokémon oförändrat", () => {
    expect(setEra({ name: "Destined Rivals", language: "EN", series: "Scarlet & Violet", releaseDate: "2025-05-30" })).toBe("Scarlet & Violet");
  });
  it("ordning: boosters först, Other sist", () => {
    expect(eraRank("Booster Sets")).toBeLessThan(eraRank("Starter Decks"));
    expect(eraRank("Starter Decks")).toBeLessThan(eraRank("Other"));
  });
});
