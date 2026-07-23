import { describe, expect, it } from "vitest";
import { bucketObservationsBySource } from "../../src/services/products";

const cm = (iso: string, price: number) => ({
  price,
  observedAt: new Date(iso),
  source: { name: "Cardmarket" },
});

describe("bucketObservationsBySource", () => {
  it("Cardmarket-serien tar SISTA observationen per dag, inte dagsmedel", () => {
    // 2026-07-23-incidenten: avbruten körning skrev det frusna 281k-värdet 15:38,
    // omkörningen healade till 69.6k 18:30. Medlet (175 439 kr) fanns aldrig på
    // marknaden — grafen ska visa den senaste skrivningen.
    const res = bucketObservationsBySource([
      cm("2026-07-23T15:38:09Z", 28126500),
      cm("2026-07-23T18:30:16Z", 6961354),
    ]);
    expect(res.cardmarket).toEqual([{ date: "2026-07-23", price: 6961354 }]);
  });

  it("sista-per-dag gäller även när observationerna kommer i fel ordning", () => {
    const res = bucketObservationsBySource([
      cm("2026-07-23T18:30:16Z", 6961354),
      cm("2026-07-23T15:38:09Z", 28126500),
    ]);
    expect(res.cardmarket).toEqual([{ date: "2026-07-23", price: 6961354 }]);
  });

  it("morgonens trend-obs (Pokémon TCG API) ersätts av eftermiddagens CM-From", () => {
    const res = bucketObservationsBySource([
      { price: 100_00, observedAt: new Date("2026-07-23T05:00:00Z"), source: { name: "Pokémon TCG API" } },
      cm("2026-07-23T15:00:00Z", 80_00),
    ]);
    expect(res.cardmarket).toEqual([{ date: "2026-07-23", price: 80_00 }]);
  });

  it("Tradera och butiker behåller dagsmedel (flera obs = olika annonser)", () => {
    const res = bucketObservationsBySource([
      { price: 100_00, observedAt: new Date("2026-07-23T10:00:00Z"), source: { name: "Tradera" } },
      { price: 200_00, observedAt: new Date("2026-07-23T12:00:00Z"), source: { name: "Tradera" } },
      { price: 300_00, observedAt: new Date("2026-07-23T10:00:00Z"), source: { name: "Spelexperten" } },
      { price: 500_00, observedAt: new Date("2026-07-23T12:00:00Z"), source: { name: "Webhallen" } },
    ]);
    expect(res.tradera).toEqual([{ date: "2026-07-23", price: 150_00 }]);
    expect(res.butiker).toEqual([{ date: "2026-07-23", price: 400_00 }]);
  });

  it("serier sorteras stigande på datum och dagar hålls isär", () => {
    const res = bucketObservationsBySource([
      cm("2026-07-23T15:00:00Z", 200),
      cm("2026-07-22T15:00:00Z", 100),
    ]);
    expect(res.cardmarket).toEqual([
      { date: "2026-07-22", price: 100 },
      { date: "2026-07-23", price: 200 },
    ]);
  });
});
