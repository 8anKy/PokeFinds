import { describe, expect, it } from "vitest";
import { isPromoSet, pickGradedCandidate, splitGradedCardName } from "../../src/services/grading/card-link";

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

/**
 * KANDIDATVALET (2026-10-01). Kandidatlistorna nedan är skannerns riktiga utdata ur
 * prod för graderingar som aldrig fick någon bild.
 */
describe("pickGradedCandidate", () => {
  const dt = [
    { name: "Dark Tyranitar", setName: "Team Rocket Returns", number: "19" },
    { name: "Dark Tyranitar", setName: "30th Celebration: Classic Collection", number: "19" },
    { name: "Dark Tyranitar", setName: "Team Rocket Returns", number: "20" },
  ];

  it("Classic Collection-nytrycket: setordet avgör mellan samma namn + nummer", () => {
    expect(pickGradedCandidate(dt, "Dark Tyranitar", "19", "Celebrations Classic Collection")).toBe(1);
  });

  it("utan setord förblir ett äkta oavgjort olöst — ingen bild", () => {
    expect(pickGradedCandidate(dt, "Dark Tyranitar", "19", null)).toBe(-1);
    expect(pickGradedCandidate(dt, "Dark Tyranitar", "19", "Base Set")).toBe(-1);
  });

  it("exakt namn slår ett nästan-namn med samma nummer (GX ≠ G)", () => {
    const c = [
      { name: "Charizard G", setName: "Supreme Victors", number: "20" },
      { name: "Charizard-GX", setName: "Burning Shadows", number: "20" },
      { name: "Charizard", setName: "Boundaries Crossed", number: "20" },
    ];
    expect(pickGradedCandidate(c, "Charizard GX", "20", "Burning Shadows")).toBe(1);
  });

  it("setgissningen räcker aldrig ensam — numret måste stämma", () => {
    const c = [{ name: "Dragonair", setName: "151", number: "148" }];
    expect(pickGradedCandidate(c, "Dragonair", "122", "151")).toBe(-1);
  });
});

describe("promokoder i numret (2026-10-01)", () => {
  it("splitGradedCardName läser 'SVP 132' som numret", () => {
    expect(splitGradedCardName("Greninja ex SVP 132 · Black Star Promos")).toEqual({
      name: "Greninja ex",
      number: "SVP132",
    });
  });

  it("katalogens 'MEP 099' matchar modellens 'MEP099'", () => {
    const c = [{ name: "Greninja ex", number: "MEP 099", setName: "MEP Black Star Promos" }];
    expect(pickGradedCandidate(c, "Greninja ex", "MEP099", null)).toBe(0);
  });

  it("isPromoSet känner igen promoseten, inte vanliga set", () => {
    expect(isPromoSet("Scarlet & Violet Black Star Promos")).toBe(true);
    expect(isPromoSet("SWSH Black Star Promos")).toBe(true);
    expect(isPromoSet("Twilight Masquerade")).toBe(false);
    expect(isPromoSet("Promotional Deck")).toBe(false);
  });
});

describe("naket nummer före setgissningen (2026-10-01)", () => {
  it("'Articuno 22 · WotC Promo' ger numret 22", () => {
    expect(splitGradedCardName("Articuno 22 · WotC Promo")).toEqual({ name: "Articuno", number: "22" });
  });
  it("ett tal inne i setgissningen räknas inte", () => {
    expect(splitGradedCardName("Charizard · Base Set 2")).toEqual({ name: "Charizard · Base Set 2", number: null });
  });
  it("total-formen vinner fortfarande", () => {
    expect(splitGradedCardName("Mew ex 30/25 · Celebrations").number).toBe("30/25");
  });
});
