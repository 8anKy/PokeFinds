import { describe, expect, it } from "vitest";
import { splitGradedCardName } from "../../src/services/grading/card-link";

/**
 * Graderingen sparar aldrig användarens foton, så historikens enda möjliga bild är
 * KATALOGENS — och den kräver att vi vet vilket kort det var. Det enda spåret är
 * modellens fritextsträng.
 *
 * Strängarna nedan är HÄMTADE UR PROD 2026-08-05, inte påhittade. De visar varför
 * numret måste bära identiteten: modellen skriver ut ett setnamn och har fel på det
 * (Camerupt 28/217 är Ascended Heroes, inte Obsidian Flames) och hedgar öppet
 * ("Promo / Astral set"). Numret stämde i alla tre fallen.
 */
describe("splitGradedCardName", () => {
  it("delar upp modellens riktiga utdata (Camerupt, fel setgissning)", () => {
    expect(splitGradedCardName("Camerupt 028/217 · Scarlet & Violet: Obsidian Flames"))
      .toEqual({ name: "Camerupt", number: "028/217" });
  });

  it("delar upp samma kort med en ANNAN felaktig setgissning", () => {
    expect(splitGradedCardName("Camerupt 028/217 · Ascending Heroes"))
      .toEqual({ name: "Camerupt", number: "028/217" });
  });

  it("tål att modellen hedgar om setet", () => {
    expect(splitGradedCardName("Raboot 037/217 · ASC (Scarlet & Violet Promo / Astral set)"))
      .toEqual({ name: "Raboot", number: "037/217" });
  });

  it("klarar flerordsnamn med ägarprefix", () => {
    expect(splitGradedCardName("Lillie's Clefairy ex 195/215 · SVP"))
      .toEqual({ name: "Lillie's Clefairy ex", number: "195/215" });
  });

  it("klarar bokstavsnumrerade kort", () => {
    expect(splitGradedCardName("Falinks TG07 · Astral Radiance"))
      .toEqual({ name: "Falinks", number: "TG07" });
  });

  // ⛔ Ett bart namn ger `number: null` ⇒ resolveGradedCard returnerar null ⇒ ingen
  // bild. 92 % av katalogen delar namn med minst ett annat kort, så en bild vald på
  // namn allena är ett tärningskast presenterat som ett faktum.
  it("ger inget nummer när strängen bara är ett namn", () => {
    expect(splitGradedCardName("Charizard")).toEqual({ name: "Charizard", number: null });
  });

  it("städar bort avskiljaren som blir kvar efter numret", () => {
    expect(splitGradedCardName("Pikachu 25/102 -").name).toBe("Pikachu");
  });

  it("tål tomt och saknat värde", () => {
    expect(splitGradedCardName(null)).toEqual({ name: "", number: null });
    expect(splitGradedCardName("  ")).toEqual({ name: "", number: null });
  });
});
