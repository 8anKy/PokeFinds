/**
 * Vilka set får en ruta på /sets. Fallen är riktiga setnamn ur katalogen 2026-10-16.
 */
import { describe, expect, it } from "vitest";
import { isSetListed } from "@/lib/set-listing";

const en = (name: string, externalId: string | null = null) => ({ name, language: "EN", externalId, releaseDate: null });
const jp = (name: string, externalId: string | null = "ct:1", releaseDate: string | null = null) => ({
  name,
  language: "JP",
  externalId,
  releaseDate,
});

describe("isSetListed — engelska", () => {
  it.each([
    "30th Celebration",
    "30th Celebration: Classic Collection",
    "Delta Reign",
    "Brilliant Stars Trainer Gallery",
    "Hidden Fates Shiny Vault",
    "McDonald's Collection 2024",
    "McDonald's Collection 25th Anniversary",
    "Trick or Trade 2023",
    "POP Series 5",
    "Kalos Starter Set",
    "SWSH Black Star Promos",
  ])("visar %s", (name) => expect(isSetListed(en(name))).toBe(true));

  it.each([
    "BW Trainer Kit Zoroark",
    "EX Trainer Kit Latias",
    "World Championship Decks 2004",
    "Battle Academy 2022",
    "League Promos",
    "Prerelease Promos",
    "Theme Deck & Blisters Exclusives",
    "Holiday Calendar",
    "Pokémon TCG Classic: Charizard & Ho-Oh ex Deck",
    "Play! Pokémon Prize Pack Series",
    "Radiant Collection Generation",
  ])("döljer %s", (name) => expect(isSetListed(en(name, "ct:1"))).toBe(false));
});

describe("isSetListed — japanska", () => {
  it.each([
    ["Abyss Eye (M5)", "tcggo-jp:1"],
    ["30th Celebration (M6A)", null],
    ["Shield (S1H)", "tcggo-jp:2"],
    ["Mega Series Promos (MP)", "tcggo-jp:3"],
    ["Vending Machine Series 2 (Red)", "tcggo-jp:4"],
    ["Eevee Heroes VMAX Special Set (SP4)", null],
    // Äldre däck: samlare behandlar dem som set.
    ["Garchomp Half Deck (GBR)", "tcggo-jp:5"],
    ["Keldeo Battle Strength Deck (KLD)", "tcggo-jp:6"],
    ["MCharizard EX Mega Battle Deck (XYA)", "ct:7"],
    ["Xerneas Half Deck (X30)", "ct:8"],
    ["XY Beginning Set (HXY)", "ct:9"],
    ["MEGA Start Deck 100 Battle Collection (MC)", "ct:10"],
  ])("visar %s", (name, ext) => expect(isSetListed(jp(name, ext))).toBe(true));

  it.each([
    "Fighting Starter Set V (SA5)",
    "VMAX Starter Deck: Charizard VMAX (SCJP-C)",
    "Battle Master Deck Tera Charizard ex (SVJL)",
    "Ruler of the Black Flame Deck Build Box (SVF)",
    "Premium Trainer Box VSTAR (SK)",
    "Scarlet & Violet Battle Academy (SVL)",
    "ex Start Decks (SVD)",
    "Zacian + Zamazenta BOX (SP1)",
    "Pokémon Card Game Classic: Venusaur & Lugia ex Deck (CLF)",
  ])("döljer %s", (name) => expect(isSetListed(jp(name))).toBe(false));

  it("DP/Pt-erans däck och boxar döljs", () => {
    expect(isSetListed(jp("DPt Gift Box (Pikachu) (PtPK)", null, "2008-11-20"))).toBe(false);
    expect(isSetListed(jp("Battle Starter Deck (Raichu) (BSDr)", null, "2009-11-20"))).toBe(false);
    expect(isSetListed(jp("Dialga LV.X Constructed Standard Deck", null, "2007-07-05"))).toBe(false);
  });

  it("okänd era: källan avgör", () => {
    expect(isSetListed(jp("Some Constructed Deck", null))).toBe(true);
    expect(isSetListed(jp("Some Starter Set", "ct:99"))).toBe(false);
  });

  it("släppdatumet avgör eran när koden saknas", () => {
    expect(isSetListed(jp("Some Starter Set", "ct:99", "2012-03-01"))).toBe(true);
    expect(isSetListed(jp("Some Starter Set", null, "2023-03-01"))).toBe(false);
  });
});
