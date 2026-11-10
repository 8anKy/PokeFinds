import { describe, it, expect } from "vitest";
import { onePieceSealedCategory, onePieceAcceptedEur } from "../../src/jobs/op-sealed-import";

describe("One Piece sealed: vilka rader blir produkter", () => {
  it("riktig sealed får en kategori", () => {
    expect(onePieceSealedCategory("Romance Dawn Booster Box")).toBe("BOOSTER_BOX");
    expect(onePieceSealedCategory("Heroines Edition Vol.2 Booster")).toBe("BOOSTER_PACK");
    expect(onePieceSealedCategory("Starter Deck: Absolute Justice")).toBe("COLLECTION_BOX");
    expect(onePieceSealedCategory("Illustration Box Vol.8")).toBe("COLLECTION_BOX");
    expect(onePieceSealedCategory("Premium Card Collection - Best Selection Vol.3")).toBe("COLLECTION_BOX");
    expect(onePieceSealedCategory("2nd Anniversary Set / 4 Emperors (English Version)")).toBe("COLLECTION_BOX");
  });
  it("grossist och tillbehör blir aldrig produkter", () => {
    expect(onePieceSealedCategory("Romance Dawn Booster Box Case (12x Booster Box)")).toBeNull();
    expect(onePieceSealedCategory("Come in, World Booster Box Case")).toBeNull();
    expect(onePieceSealedCategory("Royal Blood Sleeved Booster Pack Case (24x Packs)")).toBeNull();
    expect(onePieceSealedCategory('70 "Nami" V.2 Sleeves')).toBeNull();
    expect(onePieceSealedCategory("Cardboard Deckbox (Trafalgar Law)")).toBeNull();
    expect(onePieceSealedCategory("Official Playmat - Luffy")).toBeNull();
    expect(onePieceSealedCategory("Treasure Boosters Set Case")).toBeNull();
  });
});

describe("One Piece sealed: prisvakt", () => {
  it("From nära snittet godkänns, glitchar och tomma marknader inte", () => {
    expect(onePieceAcceptedEur({ lowest: 950, available_items: 167, "30d_average": 1045 })).toBe(950);
    expect(onePieceAcceptedEur({ lowest: 16900, available_items: 15, "30d_average": 5492 })).toBeNull();
    expect(onePieceAcceptedEur({ lowest: 0.02, available_items: 3, "30d_average": 40 })).toBeNull();
    expect(onePieceAcceptedEur({ lowest: 40, available_items: 0, "30d_average": 40 })).toBeNull();
    expect(onePieceAcceptedEur({ lowest: 40, available_items: 2 })).toBe(40);
    expect(onePieceAcceptedEur(null)).toBeNull();
  });
});
