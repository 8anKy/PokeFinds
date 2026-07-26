import { describe, it, expect } from "vitest";
import { lowestOfferSource } from "../../src/lib/offer-source";

// Regression 2026-07-26: produktsidans prisrubrik stod hårdkodad som
// "Lägsta pris · NM engelska (Cardmarket)" på ALLA singlar — även de 2 751 där
// vinnaren var en Tradera-annons och de 366 (tre nya set) som inte hade någon
// CM-offer alls. Rubriken namngav en källa som varken hade pris eller länk.

const offer = (
  name: string,
  price: number | null,
  stockStatus = "IN_STOCK",
  url = `https://www.cardmarket.com/en/Pokemon/Products/Singles/x?language=1`
) => ({ price, stockStatus, url, retailer: { name } });

const TRADERA = "https://www.tradera.com/item/1001337/741542750/mega-darkrai-ex";

describe("lowestOfferSource", () => {
  it("namnger Cardmarket när CM-offern är billigast", () => {
    const offers = [offer("Cardmarket", 29000), offer("Tradera", 39000, "IN_STOCK", TRADERA)];
    expect(lowestOfferSource(offers, 29000)).toEqual({ name: "Cardmarket", live: true });
  });

  it("namnger Tradera när Tradera är billigast", () => {
    const offers = [offer("Cardmarket", 29000), offer("Tradera", 17900, "IN_STOCK", TRADERA)];
    expect(lowestOfferSource(offers, 17900)).toEqual({ name: "Tradera", live: true });
  });

  it("Tradera-only (nytt set utan CM-data) → Tradera, aldrig Cardmarket", () => {
    expect(lowestOfferSource([offer("Tradera", 17900, "IN_STOCK", TRADERA)], 17900)).toEqual({ name: "Tradera", live: true });
  });

  it("i lager slår slutsålt även när slutsålt är billigare", () => {
    const offers = [
      offer("Cardmarket", 5000, "OUT_OF_STOCK"),
      offer("Tradera", 9000, "IN_STOCK", TRADERA),
    ];
    expect(lowestOfferSource(offers, 9000)).toEqual({ name: "Tradera", live: true });
  });

  it("allt slutsålt → lägsta slutsålda", () => {
    const offers = [
      offer("Cardmarket", 5000, "OUT_OF_STOCK"),
      offer("Tradera", 9000, "OUT_OF_STOCK", TRADERA),
    ];
    expect(lowestOfferSource(offers, 5000)).toEqual({ name: "Cardmarket", live: false });
  });

  it("inget pris visas → ingen källa", () => {
    expect(lowestOfferSource([offer("Cardmarket", 29000)], null)).toBeNull();
    expect(lowestOfferSource([], 29000)).toBeNull();
  });

  it("prislösa länk-offers räknas inte", () => {
    expect(lowestOfferSource([offer("Cardmarket", null), offer("Tradera", 100, "IN_STOCK", TRADERA)], 100)).toEqual({ name: "Tradera", live: true });
  });

  it("söklänkar räknas inte (samma regel som servern)", () => {
    const search = offer("Tradera", 100, "IN_STOCK", "https://www.tradera.com/search?q=pokemon");
    expect(lowestOfferSource([search, offer("Cardmarket", 29000)], 29000)).toEqual({ name: "Cardmarket", live: true });
  });

  it("avstår när urvalet inte förklarar den visade siffran", () => {
    // Skyddar mot att rubriken självsäkert namnger fel källa om server- och
    // klienturvalet någon gång glider ifrån varandra.
    expect(lowestOfferSource([offer("Cardmarket", 29000)], 12345)).toBeNull();
  });

  // 2026-07-27: prisjobben märker en CM-offer OUT_OF_STOCK precis när siffran är en
  // UPPSKATTNING (`lowest_near_mint` saknades). "Lägsta pris · NM engelska" över ett
  // sådant värde påstår att det finns en annons att vara lägst bland. `live` låter
  // rubriken skilja de två fallen åt.
  it("live=false när den vinnande offern inte är i lager (uppskattning)", () => {
    expect(lowestOfferSource([offer("Cardmarket", 5000, "OUT_OF_STOCK")], 5000)).toEqual({
      name: "Cardmarket",
      live: false,
    });
  });

  it("live=true så snart det finns en offer i lager som förklarar siffran", () => {
    expect(lowestOfferSource([offer("Cardmarket", 5000, "IN_STOCK")], 5000)).toEqual({
      name: "Cardmarket",
      live: true,
    });
  });
});
