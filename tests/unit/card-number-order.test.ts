import { describe, it, expect } from "vitest";
import {
  compareCardNumbers,
  cardNumberSortKey,
  parseCardNumber,
} from "../../src/lib/card-number-order";

// `Card.number` är TEXT, så en rak sortering ger bokstavsordning: Base börjar
// 1, 10, 100, 101, 102, 11 … Formaten är uppmätta över katalogens 20 563 kort
// (2026-07-28): 18 931 rena tal, 1 510 "TG28"-prefix, 71 "143a"-suffix, 31 rena
// bokstäver, 10 "MEP 074", 8 "SM103a" och två Unown ("!" och "?").

const sortNums = (xs: string[]) => [...xs].sort(compareCardNumbers);

describe("compareCardNumbers — samlarordning", () => {
  it("sorterar numeriskt, inte lexikalt (hela Base-problemet)", () => {
    expect(sortNums(["1", "10", "100", "101", "102", "11", "2", "20"]))
      .toEqual(["1", "2", "10", "11", "20", "100", "101", "102"]);
  });

  it("nollutfyllda nummer är SAMMA nummer (importerna zero-paddar olika)", () => {
    // Samma plats i ordningen ⇒ identisk nyckel. Komparatorn bryter ändå lika på
    // råsträngen, så ordningen blir deterministisk i stället för inmatningsberoende.
    expect(cardNumberSortKey("006")).toBe(cardNumberSortKey("6"));
    expect(parseCardNumber("006").num).toBe(6);
    expect(sortNums(["010", "9", "0007"])).toEqual(["0007", "9", "010"]);
  });

  it("suffixet står direkt efter sitt grundnummer (115a ≠ 115)", () => {
    expect(sortNums(["116", "115a", "115", "115b"])).toEqual(["115", "115a", "115b", "116"]);
  });

  it("huvudnumreringen före delserierna, delserierna alfabetiskt", () => {
    expect(sortNums(["TG12", "44", "GG01", "TG2", "1"]))
      .toEqual(["1", "44", "GG01", "TG2", "TG12"]);
  });

  it("prefix med mellanslag räknas som prefix (MEP 074)", () => {
    expect(parseCardNumber("MEP 074")).toEqual({ prefix: "mep", num: 74, suffix: "" });
    expect(sortNums(["MEP 100", "MEP 074", "MEP 9"])).toEqual(["MEP 9", "MEP 074", "MEP 100"]);
  });

  it("prefix OCH suffix samtidigt (SM103a)", () => {
    expect(parseCardNumber("SM103a")).toEqual({ prefix: "sm", num: 103, suffix: "a" });
    expect(sortNums(["SM103a", "SM103", "SM30a"])).toEqual(["SM30a", "SM103", "SM103a"]);
  });

  it("kort utan tal hamnar sist — de har ingen plats i talraden", () => {
    expect(sortNums(["!", "5", "?", "A", "1"])).toEqual(["1", "5", "!", "?", "A"]);
  });

  it("Unowns alfabet (Unseen Forces) sorteras som ett alfabet, inte som en klump", () => {
    // 28 kort där BOKSTAVEN är samlarordningen: A–Z + "!" + "?".
    expect(sortNums(["C", "A", "Z", "B", "M"])).toEqual(["A", "B", "C", "M", "Z"]);
    // ...och de ligger efter setets numrerade kort.
    expect(sortNums(["B", "94", "A", "1"])).toEqual(["1", "94", "A", "B"]);
  });

  it("är total och stabil: samma indata ger samma ordning oavsett startordning", () => {
    const a = sortNums(["TG12", "115a", "6", "!", "115", "MEP 074", "1"]);
    const b = sortNums(["1", "MEP 074", "115", "!", "6", "115a", "TG12"]);
    expect(a).toEqual(b);
  });
});

// Ordningen finns på TVÅ ställen: komparatorn (setsidan, redan hämtat data) och
// den GENERATED kolumnen Card.numberSortKey (katalogen, som pagineras i SQL).
// Går de isär sorteras samma set olika beroende på vilken sida man tittar på.
describe("cardNumberSortKey — samma ordning som komparatorn", () => {
  const SAMPLES = [
    "1", "2", "6", "006", "9", "10", "11", "20", "44", "100", "101", "102",
    "115", "115a", "115b", "116", "143a", "182b", "TG1", "TG2", "TG12", "TG28",
    "GG01", "GG44", "SV1", "RC5", "H5", "MEP 074", "MEP 100", "SM30a", "SM103a",
    "A", "B", "!", "?",
  ];

  it("nyckeln har fast bredd (annars sorterar textjämförelsen fel)", () => {
    for (const s of SAMPLES) expect(cardNumberSortKey(s)).toHaveLength(14);
  });

  it("innehåller ALDRIG mellanslag (ignorerbara i icke-C-collation)", () => {
    for (const s of SAMPLES) expect(cardNumberSortKey(s)).not.toMatch(/ /);
  });

  it("textsortering på nyckeln ger exakt komparatorns ordning", () => {
    const byKey = [...SAMPLES].sort((a, b) => {
      const ka = cardNumberSortKey(a), kb = cardNumberSortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : a.localeCompare(b);
    });
    expect(byKey).toEqual(sortNums(SAMPLES));
  });

  it("nycklarna är ense med komparatorn parvis (tecken för tecken)", () => {
    for (const a of SAMPLES) {
      for (const b of SAMPLES) {
        const ka = cardNumberSortKey(a), kb = cardNumberSortKey(b);
        if (ka === kb) continue; // lika nyckel = samma plats; komparatorn bryter lika med råsträngen
        expect(Math.sign(compareCardNumbers(a, b))).toBe(ka < kb ? -1 : 1);
      }
    }
  });
});
