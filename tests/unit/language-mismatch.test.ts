/**
 * languageMismatch — PER SPRÅK, inte binärt EN/icke-EN. Buggen som fixades:
 * koreanska annonser matchade japanska produkter (båda "icke-EN") → Shinycards
 * "…Koreansk"-sidor blev offers på "(Japansk)"-produkter.
 */
import { describe, expect, it } from "vitest";
import { languageMismatch, titleLanguage } from "@/scrapers/matching";

describe("titleLanguage", () => {
  it("JP-set-markören (Scarlet ex / Violet ex) räknas som japansk", () => {
    expect(titleLanguage("Violet ex Booster Box")).toBe("JP");
    expect(titleLanguage("Scarlet & Violet Booster Box")).toBe("EN");
  });
});

describe("languageMismatch per språk", () => {
  it("koreansk annons ≠ japansk produkt (gamla buggen)", () => {
    expect(
      languageMismatch(
        "Pokemon Scarlet & Violet Wild Force Booster Box Koreansk",
        "Pokemon Scarlet & Violet: Wild Force Booster Box (Japansk)"
      )
    ).toBe(true);
  });
  it("kinesisk ≠ japansk, kinesisk ≠ engelsk", () => {
    expect(languageMismatch("151 Gem Pack Kinesisk", "151 Booster Pack (Japansk)")).toBe(true);
    expect(languageMismatch("151 Gem Pack Kinesisk", "151 Booster Pack")).toBe(true);
  });
  it("japansk ↔ japansk och engelsk ↔ engelsk är OK", () => {
    expect(
      languageMismatch(
        "Wild Force Booster Pack (Japansk) - sv5K",
        "Pokemon Scarlet & Violet: Wild Force Booster (Japansk)"
      )
    ).toBe(false);
    expect(languageMismatch("Surging Sparks ETB", "Surging Sparks Elite Trainer Box")).toBe(false);
  });
  it("japansk ≠ engelsk (kvar sedan förr)", () => {
    expect(languageMismatch("151 Booster Pack (Japansk)", "151 Booster Pack")).toBe(true);
  });
});
