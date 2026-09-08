/**
 * languageMismatch — PER SPRÅK, inte binärt EN/icke-EN. Buggen som fixades:
 * koreanska annonser matchade japanska produkter (båda "icke-EN") → Shinycards
 * "…Koreansk"-sidor blev offers på "(Japansk)"-produkter.
 */
import { describe, expect, it } from "vitest";
import { languageMismatch, nonEraCoverage, productsConflict, titleLanguage } from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";

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

/**
 * "EN" är detektorns FALLBACK, inte ett bevis — buggen som förstörde JP-sealed
 * (2026-09-08). Katalogens japanska sealed bär Cardmarkets namn UTAN språkmarkör
 * ("Abyss Eye Booster Box"), så vakten läste dem som engelska medan varje svensk
 * butik skriver "(Japansk)" ⇒ den riktiga produkten föll ur poolen på varje annons
 * och en "(JP)"-stub tog över. Produktens språk står i Product.language.
 */
describe("Product.language räddar omärkta katalogtitlar", () => {
  const CM_NAME = "Abyss Eye Booster Box"; // Cardmarkets namn: ingen språkmarkör
  const LISTING = "Pokémon Abyss Eye Booster Box (Japansk) – M5";

  it("utan språk från DB: konflikt (det gamla, trasiga beteendet)", () => {
    expect(languageMismatch(LISTING, CM_NAME)).toBe(true);
  });

  it("med language=JP från DB: ingen konflikt", () => {
    expect(languageMismatch(LISTING, CM_NAME, "JP")).toBe(false);
    expect(productsConflict(LISTING, CM_NAME, "JP")).toBe(false);
  });

  // ⛔ UNDANTAGET FÅR BARA UPPHÄVA, ALDRIG SKAPA. En omärkt annonstitel mot en
  //    JP-produkt länkar i dag rätt (JP-set säljs ofta med bara setnamnet) — den
  //    länken får inte börja blockeras, för en falskt blockerad korrekt länk syns aldrig.
  it("omärkt annons mot JP-produkt konfliktar INTE (ingen åtstramning)", () => {
    expect(languageMismatch(CM_NAME, CM_NAME, "JP")).toBe(false);
    expect(languageMismatch("Abyss Eye Booster Box", "Abyss Eye Booster Box", "JP")).toBe(false);
  });

  it("undantaget gäller BARA japanska — koreanskt och kinesiskt konfliktar ännu", () => {
    expect(languageMismatch("Abyss Eye Booster Box Koreansk", CM_NAME, "JP")).toBe(true);
    expect(languageMismatch("Abyss Eye Booster Box Kinesisk", CM_NAME, "JP")).toBe(true);
  });

  it("en JP-annons mot en produkt som DB säger är EN konfliktar ännu", () => {
    expect(languageMismatch("151 Booster Pack (Japansk)", "151 Booster Pack", "EN")).toBe(true);
  });

  // Markören i titeln VINNER: DB får inte skriva över ett uttalat språk.
  it("titelns egen markör styr fortfarande när den finns", () => {
    expect(languageMismatch(LISTING, "Abyss Eye Booster Box (Koreansk)", "JP")).toBe(true);
  });
});

/**
 * nonEraCoverage — annonsens EGNA identitetsord måste täckas av kandidaten. Två ord
 * hörde aldrig hemma i den mängden, och båda sänkte täckningen för japansk sealed
 * under golvet 0,6 (2026-09-08):
 *   · SET-KODEN "M1S"/"M2"/"M5" (japanska Mega Evolution) — SET_CODE kände sv/swsh/me
 *     men inte M-familjen, precis som `me` en gång saknades. Håll den i synk med
 *     MERGE_SET_CODE_RE.
 *   · SPRÅKORDET "Japansk" — språk har en EGEN vakt (languageMismatch) med
 *     Product.language som facit. Att väga in det här igen dömer samma sak två gånger.
 * Cardmarkets namn bär varken kod eller språkord, så ett tvåordsnamn föll till 0,500.
 */
describe("nonEraCoverage: set-kod och språkord är inte produktidentitet", () => {
  const cov = (listing: string, candidate: string) =>
    nonEraCoverage(normalizeTitle(listing), normalizeTitle(candidate));

  it("japansk M-setkod sänker inte täckningen", () => {
    expect(cov("Pokémon Mega Symphonia Booster Box (Japansk) – M1S", "Mega Symphonia Booster Box")).toBeGreaterThanOrEqual(0.6);
    expect(cov("Pokémon Mega Brave Booster Box (Japansk) – M1L", "Mega Brave Booster Box")).toBeGreaterThanOrEqual(0.6);
    expect(cov("Pokémon Abyss Eye Booster Box (Japansk) – M5", "Abyss Eye Booster Box")).toBeGreaterThanOrEqual(0.6);
  });

  it("språkordet räknas inte som identitet ens i ett tvåordsnamn", () => {
    expect(cov("Pokémon Inferno x Booster Box (Japansk) – M2", "Inferno X Booster Box")).toBeGreaterThanOrEqual(0.6);
  });

  // ⛔ Vidgningen får inte äta upp riktiga setnamn: en MER SPECIFIK annons ska
  //    fortfarande inte kunna matcha basprodukten.
  it("delsetnamn är fortfarande identitet", () => {
    expect(cov("Mega Evolution Perfect Order Elite Trainer Box", "Mega Evolution Elite Trainer Box")).toBeLessThan(0.6);
  });
});
