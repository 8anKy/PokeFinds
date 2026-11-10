import { describe, it, expect } from "vitest";
import { isOnePieceAltVersion, onePieceCardNumber, onePieceSinglePrice, onePieceSingleTitle } from "../../src/jobs/op-singles-import";

describe("One Piece-singlar: pris (2026-11-10)", () => {
  it("engelsk NM-From rakt av när den finns och har annonser", () => {
    expect(onePieceSinglePrice({ lowest_near_mint: 18, available_items: 177, "30d_average": 22.11, "7d_average": 19.78 })).toEqual({ eur: 18, live: true });
  });
  it("utan From ⇒ uppskattning ur 7-dagarssnittet, annars 30 dagar", () => {
    expect(onePieceSinglePrice({ lowest_near_mint: null, "7d_average": 4.6, "30d_average": 4.72 })).toEqual({ eur: 4.6, live: false });
    expect(onePieceSinglePrice({ "30d_average": 1.2 })).toEqual({ eur: 1.2, live: false });
  });
  it("⛔ ett utrop (> 10× snittet och > 25 € över) blir aldrig priset", () => {
    expect(onePieceSinglePrice({ lowest_near_mint: 500, available_items: 1, "30d_average": 20, "7d_average": 18 })).toEqual({ eur: 18, live: false });
    // 10× men under 25 € glapp: billiga kort fälls inte
    expect(onePieceSinglePrice({ lowest_near_mint: 2.5, available_items: 3, "30d_average": 0.2 })).toEqual({ eur: 2.5, live: true });
  });
  it("inget alls ⇒ null", () => {
    expect(onePieceSinglePrice(null)).toBeNull();
    expect(onePieceSinglePrice({ lowest_near_mint: 0, "30d_average": 0 })).toBeNull();
  });
});

describe("One Piece-singlar: identitet och titel", () => {
  it("numret", () => {
    expect(onePieceCardNumber({ card_number: "OP08-007" })).toBe("OP08-007");
    expect(onePieceCardNumber({ card_number: null, card_code_number: "OP-18 OP18-083" })).toBe("OP18-083");
  });
  it("alternativ konst = V.2 och uppåt", () => {
    expect(isOnePieceAltVersion("V.1")).toBe(false);
    expect(isOnePieceAltVersion(null)).toBe(false);
    expect(isOnePieceAltVersion("V.2")).toBe(true);
  });
  it("titeln skiljer grundkort och alternativ", () => {
    expect(onePieceSingleTitle("Tony Tony.Chopper", "OP08-007", "Rare", "V.1", false)).toBe("Tony Tony.Chopper OP08-007");
    expect(onePieceSingleTitle("Tony Tony.Chopper", "OP08-007", "Alternate Art", "V.2", false)).toBe("Tony Tony.Chopper OP08-007 (Alternate Art)");
    expect(onePieceSingleTitle("Monkey.D.Luffy", "OP05-119", "Alternate Art", "V.3", true)).toBe("Monkey.D.Luffy OP05-119 (Alternate Art V.3)");
  });
});
