import { describe, expect, it } from "vitest";
import { eraRank, setEra } from "@/lib/set-era";

const en = (name: string, series: string, releaseDate: string | null) => ({ name, language: "EN", series, releaseDate });
const jp = (name: string, releaseDate: string | null) => ({ name, language: "JP", series: "Other", releaseDate });

describe("setEra", () => {
  it("engelska: serien när den är en era", () => {
    expect(setEra(en("Pitch Black", "Mega Evolution", "2026-07-17"))).toBe("Mega Evolution");
    expect(setEra(en("Skyridge", "E-Card", "2003-05-12"))).toBe("e-Card");
  });

  it("engelska: datumet när serien inte är en era", () => {
    expect(setEra(en("McDonald's Collection 2021", "Other", "2021-02-09"))).toBe("Sword & Shield");
    expect(setEra(en("POP Series 5", "POP", "2007-03-01"))).toBe("Diamond & Pearl");
    expect(setEra(en("Something", "Other", null))).toBe("Other");
  });

  it("japanska: datumet, annars koden", () => {
    expect(setEra(jp("Bandit Ring (XY7)", "2015-06-20"))).toBe("XY");
    expect(setEra(jp("Abyss Eye (M5)", "2026-05-22"))).toBe("Mega Evolution");
    expect(setEra(jp("Xerneas Half Deck (X30)", null))).toBe("XY");
    expect(setEra(jp("Battle Strength Decks (BK)", null))).toBe("Black & White");
    expect(setEra(jp("Expansion Pack", "1996-10-20"))).toBe("Base");
    expect(setEra(jp("Mystery", null))).toBe("Other");
  });

  it("nyaste eran först, Other sist", () => {
    expect(eraRank("Mega Evolution")).toBeLessThan(eraRank("Base"));
    expect(eraRank("Other")).toBeGreaterThan(eraRank("Base"));
  });
});
