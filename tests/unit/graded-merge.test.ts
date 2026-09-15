import { describe, expect, it } from "vitest";
import { buildGradedCards, defaultGrade } from "@/lib/graded-merge";
import type { GradedAskRow, GradedHistory, GradedSaleRow } from "@/services/graded";

/**
 * Graderingskarusellen (2026-09-15): ett kort per bolag, betyg fallande, och
 * varje cell bär begärt (eBay), sålt (Tradera) och historik för SITT betyg —
 * aldrig ett lånat tal från ett annat betyg. Sålt med okänt betyg har ingen cell.
 */
const ask = (issuer: GradedAskRow["issuer"], gradeTenths: number, priceOre: number): GradedAskRow => ({
  source: "ebay", issuer, gradeTenths, priceOre, originalMinor: 100, originalCurrency: "USD",
  listingCount: 3, url: "https://ebay.com/itm/1", observedAt: "2026-09-15T00:00:00Z",
});
const sale = (issuer: GradedSaleRow["issuer"], gradeTenths: number | null, medianOre: number, source: GradedSaleRow["source"] = "tradera"): GradedSaleRow => ({
  source, issuer, gradeTenths, count: 2, medianOre, lowOre: medianOre, highOre: medianOre,
  lastPriceOre: medianOre, lastSoldAt: "2026-09-01T00:00:00Z", lastUrl: "https://tradera.com/x",
});
const hist = (issuer: GradedHistory["issuer"], gradeTenths: number): GradedHistory => ({
  issuer, gradeTenths, asks: [{ date: "2026-09-15", price: 1 }], sold: [], soldEbay: [],
});

describe("buildGradedCards", () => {
  it("ett kort per bolag i tjänstens ordning, betyg fallande, källorna per betyg", () => {
    const cards = buildGradedCards(
      [ask("PSA", 100, 6_000_000), ask("PSA", 90, 1_300_000), ask("CGC", 95, 500_000)],
      [sale("PSA", 100, 4_800_000), sale("BGS", 90, 1_100_000), sale("PSA", null, 200_000)],
      [hist("PSA", 100), hist("TAG", 100)]
    );
    expect(cards.map((c) => c.issuer)).toEqual(["PSA", "BGS", "CGC", "TAG"]);
    const psa = cards[0].grades;
    expect(psa.map((g) => g.gradeTenths)).toEqual([100, 90]); // okänt betyg ⇒ ingen cell
    expect(psa[0]).toMatchObject({ ask: { priceOre: 6_000_000 }, sale: { medianOre: 4_800_000 }, saleEbay: null });
    expect(psa[0].history?.asks).toHaveLength(1);
    expect(psa[1].sale).toBeNull();
    expect(cards[1].grades[0]).toMatchObject({ gradeTenths: 90, ask: null });
    expect(cards[3].grades[0]).toMatchObject({ gradeTenths: 100, ask: null, sale: null });
  });

  it("förvalt betyg = högsta med begärt pris, annars högsta alls", () => {
    const [psa, tag] = buildGradedCards(
      [ask("PSA", 90, 1), ask("PSA", 80, 1)],
      [sale("PSA", 100, 1)],
      [hist("TAG", 95), hist("TAG", 100)]
    );
    expect(defaultGrade(psa)).toBe(90); // PSA 10 har bara sålt, 9 har begärt
    expect(defaultGrade(tag)).toBe(100);
  });
});

describe("buildGradedCards: eBay-sålt är en egen cell, aldrig Traderas", () => {
  it("source 'ebay' hamnar i saleEbay, 'tradera' i sale — samma betyg, två tal", () => {
    const [psa] = buildGradedCards([], [sale("PSA", 100, 4_800_000, "tradera"), sale("PSA", 100, 5_200_000, "ebay")], []);
    expect(psa.grades[0].sale?.medianOre).toBe(4_800_000);
    expect(psa.grades[0].saleEbay?.medianOre).toBe(5_200_000);
  });
});
