import { describe, it, expect } from "vitest";
import { backfillOnePieceIds, onePieceSealedCategory, onePieceAcceptedEur } from "../../src/jobs/op-sealed-import";

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

describe("One Piece sealed: saknat cardmarket_id ur CM:s egen katalog (2026-11-24)", () => {
  const catalog = [
    { idProduct: 897435, name: 'Starter Deck: Yellow Eustass ""Captain"" Kid' },
    { idProduct: 904407, name: 'Starter Deck: Yellow Eustass ""Captain"" Kid (Asia Region Legal)' },
    { idProduct: 923827, name: "Double Pack Set Vol.13" },
    { idProduct: 111, name: "Tvetydig Booster" },
    { idProduct: 112, name: "Tvetydig Booster" },
  ];
  it("exakt namn fyller i id:t — dubblerade citattecken och HTML-kodning är samma namn", () => {
    const rows = [
      { name: "Starter Deck: Yellow Eustass &quot;Captain&quot; Kid", lang: "en", cardmarket_id: null as number | null },
      { name: "Double Pack Set Vol.13", lang: "en", cardmarket_id: null as number | null },
    ];
    expect(backfillOnePieceIds(rows, catalog)).toBe(2);
    expect(rows.map((r) => r.cardmarket_id)).toEqual([897435, 923827]);
  });
  it("gissar aldrig: tvetydigt namn, nästan-namn, annat språk och upptaget id lämnas", () => {
    const rows = [
      { name: "Tvetydig Booster", lang: "en", cardmarket_id: null as number | null },
      { name: "Double Pack Set Vol. 13", lang: "en", cardmarket_id: null as number | null },
      { name: "Double Pack Set Vol.13", lang: "jp", cardmarket_id: null as number | null },
      { name: "Annan rad", lang: "en", cardmarket_id: 923827 as number | null },
      { name: "Double Pack Set Vol.13", lang: "en", cardmarket_id: null as number | null },
    ];
    expect(backfillOnePieceIds(rows, catalog)).toBe(0);
    expect(rows.map((r) => r.cardmarket_id)).toEqual([null, null, null, 923827, null]);
  });
});

describe("One Piece: larm-hitsens bindning (ensureListingProduct)", () => {
  it("One Piece-grenen står FÖRE Pokémon-vakten som fäller 'annan franchise'", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/scrapers/runner.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function ensureListingProduct("));
    const op = fn.indexOf("if (isOnePieceListing(it.title, it.url))");
    const guard = fn.indexOf("if (isOtherFranchiseListing(cleanTitle)) return null;");
    expect(op).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(op);
  });
});
