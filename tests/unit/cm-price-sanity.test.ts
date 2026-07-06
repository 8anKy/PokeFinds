import { describe, it, expect } from "vitest";
import { sanePriceEur, saneDayMove } from "../../src/jobs/cardmarket-refresh";

// Regression: 2026-07-03 gav RapidAPI glitchad micro-lowest (~€0.03) på ~30 sealed
// → 0,33 kr korrumperade offer + prishistorik. Vakten faller tillbaka på 30d-snittet.
describe("sanePriceEur", () => {
  it("använder lowest när den är rimlig (>=20% av 30d-snittet)", () => {
    expect(sanePriceEur(300, 302.86)).toBe(300);
    expect(sanePriceEur(60, 300)).toBe(60); // exakt 20%
  });

  it("förkastar glitchad micro-lowest → 30d-snittet", () => {
    expect(sanePriceEur(0.03, 302.86)).toBe(302.86); // Destined Rivals-buggen
    expect(sanePriceEur(0, 50)).toBe(50);
  });

  it("förkastar glitchad hög lowest (>1.8x snittet) → 30d-snittet", () => {
    expect(sanePriceEur(9.9, 4.91)).toBe(4.91); // Paradox Rift Booster 2026-07-03 (2.0x)
    expect(sanePriceEur(9.1, 5)).toBe(5); // 1.82x → klämt
    expect(sanePriceEur(8.9, 5)).toBe(8.9); // 1.78x → ok (marknad kan stiga lite)
  });

  it("faller tillbaka på snittet när lowest saknas", () => {
    expect(sanePriceEur(null, 42)).toBe(42);
    expect(sanePriceEur(undefined, 42)).toBe(42);
  });

  it("släpper igenom lowest när inget snitt finns att jämföra mot", () => {
    expect(sanePriceEur(5, null)).toBe(5);
  });

  it("null när ingen prisdata alls", () => {
    expect(sanePriceEur(null, null)).toBeNull();
    expect(sanePriceEur(0, null)).toBeNull();
  });
});

// Regression: 2026-07-05 gav RapidAPI 2104 korrupta priser (commons uppblåsta,
// boxar kraschade). Dag-vakten behåller gårdagens värde vid ett hopp ≥3x åt något håll.
describe("saneDayMove", () => {
  it("släpper igenom normala rörelser (<3x)", () => {
    expect(saneDayMove(100, 100)).toBe(100);
    expect(saneDayMove(200, 100)).toBe(200); // 2x ok
    expect(saneDayMove(50, 100)).toBe(50); // halvering ok
  });
  it("klämmer orimliga hopp till gårdagens värde", () => {
    expect(saneDayMove(2309_00, 5)).toBe(5); // common 0,05kr → 2309kr
    expect(saneDayMove(300, 100)).toBe(100); // exakt 3x → klämt
    expect(saneDayMove(2, 3324_00)).toBe(3324_00); // box-krasch till 2 öre
  });
  it("släpper igenom när ingen gårdagsreferens finns", () => {
    expect(saneDayMove(9999, null)).toBe(9999);
    expect(saneDayMove(9999, 0)).toBe(9999);
  });
});
