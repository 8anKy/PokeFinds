import { describe, it, expect } from "vitest";
import {
  isAsianOnePieceListing,
  isOnePieceListing,
  matchOnePieceListing,
  normalizeOpCode,
  opCodesInTitle,
  opForm,
} from "../../src/lib/one-piece-listing";

const sets = [
  { id: "s16", name: "The Time of Battle", code: "OP-16" },
  { id: "s09", name: "Emperors in the New World", code: "OP-09" },
  { id: "s01", name: "Romance Dawn", code: "OP-01" },
  { id: "eb05", name: "Heroines Edition Vol.2", code: "EB05" },
  { id: "st32", name: "GREEN Roronoa Zoro", code: "ST32" },
  { id: "prb02", name: "One Piece Card The Best Vol.2", code: "PRB02" },
  { id: "st24", name: "GREEN Jewelry Bonney", code: "ST24" },
  { id: "acc", name: "One Piece", code: null },
];
const products = [
  { id: "p16box", title: "The Time of Battle Booster Box", setId: "s16" },
  { id: "p16bst", title: "The Time of Battle Booster", setId: "s16" },
  { id: "p16sl", title: "The Time of Battle Sleeved Booster", setId: "s16" },
  { id: "p09box", title: "Emperors in the New World Booster Box", setId: "s09" },
  { id: "p01box", title: "Romance Dawn Booster Box", setId: "s01" },
  { id: "p01pre", title: "Romance Dawn Booster Box (Pre-Errata)", setId: "s01" },
  { id: "eb05box", title: "EB05 Booster Box", setId: "eb05" },
  { id: "st32", title: "Starter Deck: Green Roronoa Zoro", setId: "st32" },
  { id: "prbbox", title: "The Best Vol.2 Booster Box", setId: "prb02" },
  { id: "p16blister", title: "The Time of Battle Sleeved Booster", setId: "x" },
  { id: "st24", title: "Starter Deck: Green Jewelry Bonney", setId: "st24" },
  { id: "dp10", title: "Double Pack Set Vol.10", setId: "s15" },
  { id: "pcc3", title: "Premium Card Collection - Best Selection Vol.3", setId: "acc2" },
];
const cat = { sets, products };

describe("One Piece-annonser: spel och språk", () => {
  it("One Piece känns igen på titeln eller sökvägen", () => {
    expect(isOnePieceListing("One Piece TCG: The Time of Battle Booster Box (OP-16)")).toBe(true);
    expect(isOnePieceListing("OP-16 Booster Box", "https://x.se/collections/one-piece/products/op16")).toBe(true);
    expect(isOnePieceListing("Pokémon TCG: Destined Rivals Booster Box")).toBe(false);
  });
  it("japanska/kinesiska/koreanska fångas i butikernas alla skrivsätt", () => {
    expect(isAsianOnePieceListing("One Piece TCG: Heroines Edition Booster Box (EB-03) - Japansk")).toBe(true);
    expect(isAsianOnePieceListing("One Piece Card Game: Romance Dawn [OP-01] Booster (Japansk version)")).toBe(true);
    expect(isAsianOnePieceListing("[JP] One Piece · Card Game Display - Royal Bloodline (OP-10)")).toBe(true);
    expect(isAsianOnePieceListing("One Piece OP-09 Booster Box (Chinese)")).toBe(true);
    expect(isAsianOnePieceListing("One Piece TCG: The Time of Battle Booster Box (OP-16)")).toBe(false);
  });
});

describe("One Piece-annonser: koder och form", () => {
  it("koder normaliseras", () => {
    expect(normalizeOpCode("OP-09")).toBe("OP09");
    expect(normalizeOpCode("EB05")).toBe("EB05");
    expect(normalizeOpCode("[PRB-02]")).toBe("PRB02");
    expect(opCodesInTitle("One Piece Card Game: Romance Dawn [OP-01] Booster")).toEqual(["OP01"]);
    expect(opCodesInTitle("ST32 Starter Deck - Green Roronoa Zoro")).toEqual(["ST32"]);
    // Kortnummer är singlar, inte set
    expect(opCodesInTitle("Promokarte Chopper (EB02-003)")).toEqual([]);
  });
  it("formen", () => {
    expect(opForm("Booster Box Case (12x Booster Box)")).toBe("case");
    expect(opForm("Card Game Display - Royal Bloodline (OP-10)")).toBe("box");
    expect(opForm("The Time of Battle Sleeved Booster")).toBe("sleeved");
    expect(opForm("Starter Deck: Green Roronoa Zoro")).toBe("deck");
    expect(opForm("Romance Dawn Booster")).toBe("booster");
  });
});

describe("One Piece-annonser: matchning mot den engelska katalogen", () => {
  it("kod + form ⇒ rätt produkt", () => {
    expect(matchOnePieceListing("One Piece TCG: The Time of Battle Booster Box (OP-16)", cat)).toBe("p16box");
    expect(matchOnePieceListing("One Piece Card Game OP-16 Booster Pack (EN)", cat)).toBe("p16bst");
    expect(matchOnePieceListing("One Piece OP16 Sleeved Booster", cat)).toBe("p16sl");
    expect(matchOnePieceListing("One Piece Card Game: The Best Vol 2 [PRB-02] Premium Booster Box", cat)).toBe("prbbox");
    expect(matchOnePieceListing("One Piece EB-05 Heroines Edition Vol.2 Booster Box", cat)).toBe("eb05box");
  });
  it("pseudo-setet \"One Piece\" stör inte koden (mätt 2026-11-10)", () => {
    expect(matchOnePieceListing("One Piece Card Game: Jewelry Bonney - Green Starter Deck ST-24", cat)).toBe("st24");
    expect(matchOnePieceListing("[ENG] One Piece · Card Game Display - The Best Vol.2 (PRB-02)", cat)).toBe("prbbox");
  });
  it("blister = sleeved booster", () => {
    expect(matchOnePieceListing("One Piece Card Game: OP16 The Time Of Battle Blister Pack (ENG)", cat)).toBe("p16sl");
  });
  it("utan set: hela produktnamnet", () => {
    expect(matchOnePieceListing("One Piece TCG: Double Pack Set Vol.10 (DP-10)", cat)).toBe("dp10");
    expect(matchOnePieceListing("One Piece Card Game: Premium Card Collection - Best Selection Vol. 3", cat)).toBe("pcc3");
  });
  it("utan kod: setets namn räcker", () => {
    expect(matchOnePieceListing("One Piece - Emperors in the New World Booster Box", cat)).toBe("p09box");
  });
  it("startdäck på ST-koden", () => {
    expect(matchOnePieceListing("One Piece Card Game: ST32 Starter Deck - Green Roronoa Zoro", cat)).toBe("st32");
  });
  it("⛔ japanska annonser matchar aldrig den engelska katalogen", () => {
    expect(matchOnePieceListing("One Piece TCG: The Time of Battle Booster Box (OP-16) - Japansk", cat)).toBeNull();
    expect(matchOnePieceListing("[JP] One Piece · Card Game Display - The Time of Battle (OP-16)", cat)).toBeNull();
  });
  it("⛔ case, okänd form och tvetydigheter ger ingen träff", () => {
    expect(matchOnePieceListing("One Piece OP-16 Booster Box Case", cat)).toBeNull();
    expect(matchOnePieceListing("One Piece OP-16 Playmat", cat)).toBeNull();
    // Romance Dawn har två boxar (vanlig + Pre-Errata): utan "Pre-Errata" är det den vanliga …
    expect(matchOnePieceListing("One Piece OP-01 Romance Dawn Booster Box", cat)).toBe("p01box");
    // … och Pre-Errata i titeln pekar ut den andra.
    expect(matchOnePieceListing("One Piece OP-01 Romance Dawn Booster Box Pre-Errata", cat)).toBe("p01pre");
    // Kod och ett annat sets namn ⇒ vi vet inte
    expect(matchOnePieceListing("One Piece OP-16 Romance Dawn Booster Box", cat)).toBeNull();
  });
});
