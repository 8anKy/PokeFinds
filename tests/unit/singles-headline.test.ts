import { describe, it, expect } from "vitest";
import {
  singlesHeadlineEur,
  guideNameMatches,
  feedMoveShares,
  DAY_MOVE_MAX,
  FEED_BREAKER_MULT,
} from "@/jobs/cardmarket-refresh";

// Ägarbeslut 2026-07-24, ombekräftat 2026-07-27: `lowest_near_mint` RAKT AV. Fältet ÄR
// Cardmarkets lägsta NM-annons på engelska; ingen guide-rad får byta ut det. Trend/30d
// är BARA fallback när fältet saknas, och då en uppskattning märkt OUT_OF_STOCK.
describe("singlesHeadlineEur (golvet rakt av)", () => {
  it("From publiceras exakt som CM listar den, hur långt från trenden den än ligger", () => {
    expect(
      singlesHeadlineEur({ from: 37000, avg30: 4093.09 }, { low: 6000, trend: 6271.49, avg30: 4093.09 })
    ).toEqual({ eur: 37000, from: true, via: "from" });
    expect(singlesHeadlineEur({ from: 3.5, avg30: 6.2 }, { low: 3.4, trend: 8.45, avg30: 6.2 })).toEqual({
      eur: 3.5,
      from: true,
      via: "from",
    });
  });

  it("utan guide-facit står From kvar orörd", () => {
    expect(singlesHeadlineEur({ from: 0.02, avg30: 2.41 }, null)).toEqual({ eur: 0.02, from: true, via: "from" });
  });

  it("MED guide-facit står den också kvar — guiden är inte CM:s From", () => {
    // Brock's Scouting JTG179: LNM 0,02 € mot guidens low 1,25 €. Att publicera guidens
    // low här var 07-25-fixen; den revs 07-27 (guidens low för Rayquaza Gold Star säger
    // 2 900 € där CM:s produktsida visar 37 000 €).
    expect(
      singlesHeadlineEur({ from: 0.02, avg30: 2.41 }, { low: 1.25, trend: 2.37, avg: 2.41, avg30: 2.31 })
    ).toEqual({ eur: 0.02, from: true, via: "from" });
  });

  it("From SAKNAS → median av referenserna som uppskattning, ALDRIG guidens low", () => {
    // Gyarados · Base 6/102: guidens low 2 € är ett trasigt exemplar. Referenserna
    // (trend 19,35 / avg 18,12 / avg30 17,36 / RapidAPI 30d 156,36) har median 18,74.
    expect(
      singlesHeadlineEur({ from: null, avg30: 156.36 }, { low: 2, trend: 19.35, avg: 18.12, avg30: 17.36 })
    ).toEqual({ eur: 18.735, from: false, via: "estimate" });
  });

  it("medianen låter inte ETT nollställt fält kapa uppskattningen", () => {
    // N · Noble Victories: guidens trend är 0,02 €. Median av [0,02 / 19,6 / 65,6 / 11,19] = 15,395.
    expect(
      singlesHeadlineEur({ from: null, avg30: 11.19 }, { low: 13.99, trend: 0.02, avg: 19.6, avg30: 65.6 })
    ).toEqual({ eur: 15.395, from: false, via: "estimate" });
  });

  it("medianen låter inte heller RapidAPI:s utstickare kapa den", () => {
    // Charizard · Base 4/102: RapidAPI 30d 10,46 € mot guidens 2 506 €.
    expect(
      singlesHeadlineEur({ from: null, avg30: 10.46 }, { low: 799, trend: 4050.96, avg: 3903.4, avg30: 2506.69 })
    ).toEqual({ eur: 3205.045, from: false, via: "estimate" });
  });

  it("ingen data alls (eller bara nollor) → null", () => {
    expect(singlesHeadlineEur({ from: null, avg30: null }, null)).toBeNull();
    expect(singlesHeadlineEur({ from: 0, avg30: 0 }, { low: 0, trend: 0, avg30: 0 })).toBeNull();
  });
});

// RapidAPI kan ge fel cardmarket_id: base1-2 (Blastoise, Base) pekade på 291582,
// som enligt CM:s officiella katalog är "Rayquaza [Dual Claw | Dragon Blast]".
// Domaren är katalogNAMNET — ett pris-avståndstest gick inte att lita på: för
// base1-4 (Charizard, Base) ligger guiden och RapidAPI 240x isär och där är det
// RAPIDAPI som är trasig (30d 10,46 € på en 800 €-Charizard).
describe("guideNameMatches", () => {
  it("förkastar rader som tillhör ett annat kort", () => {
    expect(guideNameMatches("Rayquaza [Dual Claw | Dragon Blast]", "Blastoise")).toBe(false);
    expect(guideNameMatches("Stufful [Light Punch | Flop]", "Empoleon ex")).toBe(false);
    expect(guideNameMatches("Energy Switch", "Makuhita")).toBe(false);
  });

  it("släpper igenom CM:s utförligare skrivsätt", () => {
    expect(guideNameMatches("Charizard [Energy Burn | Fire Spin]", "Charizard")).toBe(true);
    expect(guideNameMatches("Donphan [Exoskeleton | Earthquake | Prime]", "Donphan")).toBe(true);
    expect(guideNameMatches("Turtwig Lv.10 [Tackle | Razor Leaf]", "Turtwig")).toBe(true);
    expect(guideNameMatches("Boss's Orders - Ghetsis", "Boss's Orders")).toBe(true);
    expect(guideNameMatches("Rayquaza [C] LV.X [Dragon Spirit | Final Blowup]", "Rayquaza C LV.X")).toBe(true);
    expect(guideNameMatches("N", "N")).toBe(true);
  });

  it("saknat namn → betrodd (konservativt)", () => {
    expect(guideNameMatches(undefined, "Blastoise")).toBe(true);
    expect(guideNameMatches("Rayquaza", null)).toBe(true);
  });

});

// Haveribrytaren skyddar mot 2026-07-05-klassen: RapidAPI korrumperar en stor ANDEL
// av feeden samtidigt. Enstaka vilda hopp är asks-marknad och räknas bara som stora.
describe("feedMoveShares", () => {
  it("räknar stora (≥3x) och extrema (≥10x) dagsrörelser åt båda hållen", () => {
    const shares = feedMoveShares([
      { newOre: 100, priorOre: 100 },   // stilla
      { newOre: 350, priorOre: 100 },   // 3.5x upp = stor
      { newOre: 100, priorOre: 350 },   // 3.5x ner = stor
      { newOre: 1500, priorOre: 100 },  // 15x = extrem (och stor)
      { newOre: 100, priorOre: null },  // nytt kort utan gårdagsvärde — utanför nämnaren
    ]);
    expect(shares.n).toBe(4);
    expect(shares.big).toBe(3);
    expect(shares.extreme).toBe(1);
    expect(shares.extremeShare).toBeCloseTo(0.25);
  });

  it("tom eller gårdagslös feed ger 0-andelar (ingen division med noll)", () => {
    expect(feedMoveShares([]).extremeShare).toBe(0);
    expect(feedMoveShares([{ newOre: 100, priorOre: null }]).n).toBe(0);
  });

  it("trösklarna är de förväntade defaultvärdena", () => {
    expect(DAY_MOVE_MAX).toBe(3);
    expect(FEED_BREAKER_MULT).toBe(10);
  });
});
