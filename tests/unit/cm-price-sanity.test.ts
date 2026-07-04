import { describe, it, expect } from "vitest";
import { sanePriceEur } from "../../src/jobs/cardmarket-refresh";

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
