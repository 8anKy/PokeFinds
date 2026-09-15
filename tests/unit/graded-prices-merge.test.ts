import { describe, expect, it } from "vitest";
import { mergeGraded } from "@/components/features/graded-sales";
import type { GradedAskRow, GradedSaleRow } from "@/services/graded";

/**
 * Graderade priser i ETT block (2026-09-15): begärt (eBay) och sålt (Tradera) på
 * samma rad per (bolag, betyg) — men aldrig i samma tal. Vaktar att raden får
 * "–" i den kolumn som saknar data, att bolagen kommer i tjänstens ordning och
 * att betygen faller.
 */
const ask = (issuer: GradedAskRow["issuer"], gradeTenths: number, priceOre: number): GradedAskRow => ({
  source: "ebay", issuer, gradeTenths, priceOre, originalMinor: 100, originalCurrency: "USD",
  listingCount: 3, url: "https://ebay.com/itm/1", observedAt: "2026-09-15T00:00:00Z",
});
const sale = (issuer: GradedSaleRow["issuer"], gradeTenths: number | null, medianOre: number): GradedSaleRow => ({
  issuer, gradeTenths, count: 2, medianOre, lowOre: medianOre, highOre: medianOre,
  lastPriceOre: medianOre, lastSoldAt: "2026-09-01T00:00:00Z", lastUrl: "https://tradera.com/x",
});

describe("mergeGraded", () => {
  it("en rad per bolag+betyg, båda källorna sida vid sida, tomt = null (aldrig lånat)", () => {
    const groups = mergeGraded(
      [ask("PSA", 100, 6_000_000), ask("PSA", 90, 1_300_000), ask("CGC", 95, 500_000)],
      [sale("PSA", 100, 4_800_000), sale("BGS", 90, 1_100_000), sale("PSA", null, 200_000)]
    );
    expect(groups.map((g) => g.issuer)).toEqual(["PSA", "BGS", "CGC"]);
    const psa = groups[0].rows;
    expect(psa.map((r) => r.gradeTenths)).toEqual([100, 90, null]); // fallande, okänt sist
    expect(psa[0].ask?.priceOre).toBe(6_000_000);
    expect(psa[0].sale?.medianOre).toBe(4_800_000);
    expect(psa[1].sale).toBeNull(); // PSA 9: bara till salu
    expect(psa[2].ask).toBeNull(); // okänt betyg: bara sålt
    expect(groups[1].rows[0]).toMatchObject({ gradeTenths: 90, ask: null });
    expect(groups[2].rows[0]).toMatchObject({ gradeTenths: 95, sale: null });
  });

  it("OTHER sist, oavsett hur många rader det har", () => {
    const groups = mergeGraded([ask("OTHER", 90, 1), ask("OTHER", 80, 1), ask("TAG", 100, 1)], []);
    expect(groups.map((g) => g.issuer)).toEqual(["TAG", "OTHER"]);
  });
});
