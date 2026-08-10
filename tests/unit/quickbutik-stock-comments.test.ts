/**
 * qbBlockStock: lagerdomen får ALDRIG läsa HTML-kommentarer.
 *
 * Incident 2026-08-10: Swepokes tema renderar mallkommentarer (`<!-- Sold out -->`,
 * `<!-- Has options -->`) i VARJE produktkort — även köpbara. SOLD_OUT_MARKERS
 * träffade kommentartexten → 101 av 101 Swepoke-offers OUT_OF_STOCK i 14 dygn,
 * noll lagerövergångar, noll restock-larm, medan butikssidan sa "I lager".
 */
import { describe, expect, it } from "vitest";
import { qbBlockStock } from "@/scrapers/adapters/quickbutik-adapter";

/** Förenklat men strukturtroget Swepoke-block efter temabytet 2026-07-27. */
const buyableWithComments = `8134" data-s-price="2199" data-s-title="Pokemon Pitch Black Booster Box"
  <a href="/alla-produkter/45-pokemon-pitch-black-booster-box"><img></a>
  <button>Lägg i varukorg</button>
  <!-- Has options -->
  <!-- Sold out -->
  <!-- Link to product when no buy button -->`;

const genuinelySoldOut = `9001" data-s-price="2499" data-s-title="Chaos Rising Booster Box"
  <a href="/alla-produkter/chaos-rising-booster-box"><img></a>
  <a area-label="Ej tillgänglig">Slutsåld</a>
  <!-- Sold out -->`;

describe("qbBlockStock", () => {
  it("mallkommentaren <!-- Sold out --> gör INTE ett köpbart block slutsålt", () => {
    const { soldOut, buyable } = qbBlockStock(buyableWithComments);
    expect(soldOut).toBe(false);
    expect(buyable).toBe(true);
  });

  it("äkta slutsåld (synlig markup) fälls fortfarande", () => {
    const { soldOut, buyable } = qbBlockStock(genuinelySoldOut);
    expect(soldOut).toBe(true);
    expect(buyable).toBe(false);
  });

  it("synlig 'Slutsåld'-text utan attribut fälls också", () => {
    expect(qbBlockStock('<button disabled>Slutsåld</button>').soldOut).toBe(true);
  });

  it("kommentar kan inte heller fejka 'i lager'", () => {
    // Utan köpmarkör utanför kommentarer är blocket inte köpbart.
    expect(qbBlockStock("<!-- Lägg i varukorg --><div>Produkt</div>").buyable).toBe(false);
  });
});
