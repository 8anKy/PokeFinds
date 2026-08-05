import { describe, it, expect } from "vitest";
import { guideReserveEur } from "../../src/jobs/cardmarket-refresh";

// GUIDE-RESERVEN (2026-08-05).
//
// Bakgrund: vår prisleverantör (TCGGO/RapidAPI) slutar ibland leverera Cardmarket-
// koppling för enskilda kort — `cardmarket_id: null` och tom `prices.cardmarket` i
// episod-feeden. Verifierat på xy9-10 (Growlithe · BREAKpoint), sm8-88, smp-SM191,
// sm11-10: vanliga kort som Cardmarket självklart HAR. Korten föll då ur körningen
// helt och gårdagens pris stod kvar för alltid under rubriken "Lägsta pris". 108
// singlar hade frusit så, de äldsta sedan 2026-06-13.
//
// Reserven prissätter dem ur Cardmarkets EGEN prisguide, men bara när identiteten
// är styrkt. Den domen testas här — den avgör om ett pris publiceras på ett kort
// vars enda kvarvarande identitetsbevis är vår egen länk.

const CATALOG = new Map<number, string>([
  [288185, "Growlithe [Bite]"], // BREAKpoint 10 — CM skriver ut attacken
  [365751, "Larvitar [Submerge | Bite]"], // Lost Thunder 114
  [365752, "Larvitar [Second Strike]"], // Lost Thunder 115 — ANNAN produkt, samma namn
  [295157, "MGengar EX [Hollow Geist]"],
]);

const GUIDE = { trend: 2, avg: 2.5, avg30: 1.5 };

describe("guideReserveEur", () => {
  it("prissätter ett kort där CM:s katalognamn håller med", () => {
    const v = guideReserveEur({ cardName: "Growlithe", idProduct: 288185 }, GUIDE, CATALOG);
    expect(v).toEqual({ eur: 2 }); // medianen av 1.5 / 2 / 2.5
  });

  it("tål att CM skriver ut attacknamn som vår katalog inte har", () => {
    const v = guideReserveEur({ cardName: "M Gengar-EX", idProduct: 295157 }, GUIDE, CATALOG);
    expect("eur" in v).toBe(true);
  });

  // ⛔ Kärnan: numret ensamt är INTE identitet. Mätt 2026-08-05 pekade
  // samlarnummer-kedjan "Charizard ex (196)" på Cardmarkets Eevee och
  // "Xerneas ex (179)" på Basic Psychic Energy. Namnvakten är det som stoppar det.
  it("avvisar när namnet är ett ANNAT kort", () => {
    expect(guideReserveEur({ cardName: "Charizard ex", idProduct: 288185 }, GUIDE, CATALOG))
      .toEqual({ reject: "name" });
  });

  // Två tryckningar/versioner av samma Pokémon är olika CM-produkter. Reserven får
  // inte råka acceptera fel av dem bara för att namnet stämmer på ordnivå — här
  // stämmer båda, och det är rätt: det är NUMRET (och därmed id:t) som skiljer dem,
  // och id:t kommer från länken, inte från den här funktionen.
  it("accepterar båda Larvitar-produkterna var för sig", () => {
    expect("eur" in guideReserveEur({ cardName: "Larvitar", idProduct: 365751 }, GUIDE, CATALOG)).toBe(true);
    expect("eur" in guideReserveEur({ cardName: "Larvitar", idProduct: 365752 }, GUIDE, CATALOG)).toBe(true);
  });

  // Regression 2026-07-26: ett cardmarket_id som pekar på en SEALED-produkt
  // publicerade boosterlådans golv som ett korts pris (3 262,70 kr för en common).
  // Saknas id:t bland CM:s singlar är raden inte en singel — då prissätts ingenting.
  it("avvisar ett idProduct som inte finns bland CM:s singlar", () => {
    expect(guideReserveEur({ cardName: "Pidgey", idProduct: 271938 }, GUIDE, CATALOG))
      .toEqual({ reject: "not-single" });
  });

  it("avstår helt när guide-raden saknas", () => {
    expect(guideReserveEur({ cardName: "Growlithe", idProduct: 288185 }, undefined, CATALOG))
      .toEqual({ reject: "no-guide-row" });
  });

  it("avstår när guide-raden saknar varje användbart pris", () => {
    expect(
      guideReserveEur({ cardName: "Growlithe", idProduct: 288185 }, { trend: 0, avg: null, avg30: null }, CATALOG)
    ).toEqual({ reject: "no-price" });
  });

  // ⛔ Guidens `low` är lägsta över ALLA skick och språk och får aldrig bli priset
  // under rubriken "NM engelska" — samma regel som resten av filen. Här bevisas att
  // reserven inte ens tittar på fältet.
  it("använder ALDRIG guidens low", () => {
    const v = guideReserveEur(
      { cardName: "Growlithe", idProduct: 288185 },
      { low: 0.02, trend: 5, avg: 5, avg30: 5 },
      CATALOG
    );
    expect(v).toEqual({ eur: 5 });
  });
});
