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
    expect(lowestOfferSource(offers, 29000)).toBe("Cardmarket");
  });

  it("namnger Tradera när Tradera är billigast", () => {
    const offers = [offer("Cardmarket", 29000), offer("Tradera", 17900, "IN_STOCK", TRADERA)];
    expect(lowestOfferSource(offers, 17900)).toBe("Tradera");
  });

  it("Tradera-only (nytt set utan CM-data) → Tradera, aldrig Cardmarket", () => {
    expect(lowestOfferSource([offer("Tradera", 17900, "IN_STOCK", TRADERA)], 17900)).toBe("Tradera");
  });

  it("i lager slår slutsålt även när slutsålt är billigare", () => {
    const offers = [
      offer("Cardmarket", 5000, "OUT_OF_STOCK"),
      offer("Tradera", 9000, "IN_STOCK", TRADERA),
    ];
    expect(lowestOfferSource(offers, 9000)).toBe("Tradera");
  });

  it("allt slutsålt → lägsta slutsålda", () => {
    const offers = [
      offer("Cardmarket", 5000, "OUT_OF_STOCK"),
      offer("Tradera", 9000, "OUT_OF_STOCK", TRADERA),
    ];
    expect(lowestOfferSource(offers, 5000)).toBe("Cardmarket");
  });

  it("inget pris visas → ingen källa", () => {
    expect(lowestOfferSource([offer("Cardmarket", 29000)], null)).toBeNull();
    expect(lowestOfferSource([], 29000)).toBeNull();
  });

  it("prislösa länk-offers räknas inte", () => {
    expect(lowestOfferSource([offer("Cardmarket", null), offer("Tradera", 100, "IN_STOCK", TRADERA)], 100)).toBe("Tradera");
  });

  it("söklänkar räknas inte (samma regel som servern)", () => {
    const search = offer("Tradera", 100, "IN_STOCK", "https://www.tradera.com/search?q=pokemon");
    expect(lowestOfferSource([search, offer("Cardmarket", 29000)], 29000)).toBe("Cardmarket");
  });

  it("avstår när urvalet inte förklarar den visade siffran", () => {
    // Skyddar mot att rubriken självsäkert namnger fel källa om server- och
    // klienturvalet någon gång glider ifrån varandra.
    expect(lowestOfferSource([offer("Cardmarket", 29000)], 12345)).toBeNull();
  });
});
