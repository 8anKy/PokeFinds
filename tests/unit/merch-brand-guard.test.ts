import { describe, expect, it } from "vitest";
import { isMerchandiseListing } from "@/scrapers/matching";

/**
 * MÄRKESVAKTEN (`NON_TCG_BRAND`, 2026-08-16).
 *
 * Re-Ment är ett japanskt leksaksbolag som gör miniatyrdioramor — aldrig TCG. 28 av
 * deras serier låg ändå i katalogen som COLLECTION_BOX, och ingen ordbaserad
 * merch-regel hade kunnat stoppa dem: varenda titel heter "... Figure Collection ...",
 * och den frasen står i `SEALED_FORM_WORD` eftersom Pokémons EGEN "Shining Legends
 * Figure Collection" är en riktig SKU med boosters i. Sealed-ordet VETADE alltså
 * merch-vakten.
 *
 * ⛔ DÄRFÖR MÅSTE MÄRKET PRÖVAS FÖRE `SEALED_FORM_WORD`. Vänder man på ordningen är
 *    vakten verkningslös igen — och felet är tyst: produkterna importeras bara vidare
 *    som vanliga sealed-varor.
 * ⛔ OCH POKÉMONS EGNA "Figure Collection" MÅSTE ÖVERLEVA. Det var hela skälet till
 *    att frasen stod i SEALED_FORM_WORD från början (mätt 2026-08-15: 8 katalog-
 *    produkter, 24 butikslänkar).
 */
describe("Re-Ment fälls trots att titeln bär ett sealed-formord", () => {
  const REMENT = [
    "Re-Ment Pokemon Terrarium Collection Vol. 12 Figure Collection Complete Box",
    "Re-Ment Pokemon Lantern Diorama Figure Collection Figure",
    "Re-Ment Samlarfigurer Pokemon Gemstone Collection Vol.2 Figure Collection figur",
    "Re-Ment Pokemon Desk Battle On Desk Figure Collection Complete Box",
    "RE MENT Pokemon Ovaltique Figure Collection",
  ];
  for (const t of REMENT) {
    it(`fäller: ${t.slice(0, 52)}…`, () => {
      expect(isMerchandiseListing(t)).toBe(true);
    });
  }

  /** ⛔ Pokémons EGNA figur-/pin-produkter är riktiga SKU:er med boosters i. */
  const REAL_SKUS = [
    "Pokémon Sun & Moon Shining Legends Shiny Darkrai GX Figure Collection",
    "Shining Legends: Raichu GX Special Collection",
    "Pokémon GO Pin Collection",
    "Team Skull Pin Collection",
    "Crown Zenith Rillaboom Pin Collection 3-Pack Blister",
    "Ascended Heroes: Mega Gardevoir Premium Poster Collection",
  ];
  for (const t of REAL_SKUS) {
    it(`släpper igenom: ${t.slice(0, 52)}…`, () => {
      expect(isMerchandiseListing(t)).toBe(false);
    });
  }

  it("ordgränsen skyddar vanliga ord som slutar på -ment", () => {
    for (const w of ["Pokemon measurement tool", "requirement", "retirement", "increment"]) {
      expect(isMerchandiseListing(w)).toBe(false);
    }
  });
});
