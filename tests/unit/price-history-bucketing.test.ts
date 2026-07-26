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
  // EN SERIE = EN STORHET (2026-07-27). Fram till 2026-06-13 skrevs pokemontcg.io:s
  // CM-TREND; från 06-19 CM:s NM-engelska GOLV. Att rita dem som en kurva gav skarvar
  // som 1 531 kr → 0,33 kr, på 19 679 av 20 514 singlar.
  it("legacy trend-punkter utesluts när äkta CM-observationer finns", () => {
    const res = bucketObservationsBySource([
      { price: 1531_07, observedAt: new Date("2026-06-01T13:00:00Z"), source: { name: "Pokémon TCG API" } },
      { price: 180_09, observedAt: new Date("2026-06-13T13:00:00Z"), source: { name: "TCGdex API" } },
      cm("2026-06-19T18:00:00Z", 33),
      cm("2026-06-20T18:00:00Z", 35),
    ]);
    expect(res.cardmarket).toEqual([
      { date: "2026-06-19", price: 33 },
      { date: "2026-06-20", price: 35 },
    ]);
  });

  it("men trend-serien behålls när det är allt som finns (14 singlar)", () => {
    const res = bucketObservationsBySource([
      { price: 500, observedAt: new Date("2026-06-01T13:00:00Z"), source: { name: "Pokémon TCG API" } },
      { price: 600, observedAt: new Date("2026-06-13T13:00:00Z"), source: { name: "Pokémon TCG API" } },
    ]);
    expect(res.cardmarket).toEqual([
      { date: "2026-06-01", price: 500 },
      { date: "2026-06-13", price: 600 },
    ]);
  });

  it("uteslutningen gäller bara CM-bucketen — Tradera/butiker rörs inte", () => {
    const res = bucketObservationsBySource([
      { price: 900, observedAt: new Date("2026-06-01T13:00:00Z"), source: { name: "Pokémon TCG API" } },
      cm("2026-06-19T18:00:00Z", 33),
      { price: 700, observedAt: new Date("2026-06-01T10:00:00Z"), source: { name: "Tradera" } },
    ]);
    expect(res.cardmarket).toEqual([{ date: "2026-06-19", price: 33 }]);
    expect(res.tradera).toEqual([{ date: "2026-06-01", price: 700 }]);
  });
});
