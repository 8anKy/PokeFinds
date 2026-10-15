import { describe, expect, it } from "vitest";
import { GRADED_VALUE_RECENT_SALES, GRADED_VALUE_WINDOW_DAYS, gradedSoldValue } from "@/lib/graded-value";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("gradedSoldValue — sold only", () => {
  it("no sales ⇒ null (the caller falls back to the ungraded value)", () => {
    expect(gradedSoldValue([], NOW)).toBeNull();
  });

  it("eBay first, never mixed with Tradera", () => {
    const v = gradedSoldValue(
      [
        { source: "tradera", price: 100_000, soldAt: daysAgo(1) },
        { source: "ebay", price: 200_000, soldAt: daysAgo(10) },
        { source: "ebay", price: 220_000, soldAt: daysAgo(20) },
      ],
      NOW
    );
    expect(v).toEqual({ valueOre: 210_000, source: "ebay", count: 2, lastSoldAt: daysAgo(10).toISOString() });
  });

  it("Tradera when eBay has nothing in the window", () => {
    const v = gradedSoldValue(
      [
        { source: "ebay", price: 500_000, soldAt: daysAgo(GRADED_VALUE_WINDOW_DAYS + 5) },
        { source: "tradera", price: 90_000, soldAt: daysAgo(3) },
      ],
      NOW
    );
    expect(v?.source).toBe("tradera");
    expect(v?.valueOre).toBe(90_000);
  });

  it("median of the most RECENT sales, not of the whole year", () => {
    const sales = [
      // Fem färska kring 300 kr …
      ...[300, 310, 290, 305, 295].map((kr, i) => ({ source: "ebay", price: kr * 100, soldAt: daysAgo(i + 1) })),
      // … och en gammal topp som inte får dra värdet.
      ...[900, 950, 1000].map((kr, i) => ({ source: "ebay", price: kr * 100, soldAt: daysAgo(200 + i) })),
    ];
    const v = gradedSoldValue(sales, NOW);
    expect(v?.count).toBe(GRADED_VALUE_RECENT_SALES);
    expect(v?.valueOre).toBe(30_000);
  });

  it("median tolerates one mismatched lot price", () => {
    const v = gradedSoldValue(
      [
        { source: "tradera", price: 50_000, soldAt: daysAgo(1) },
        { source: "tradera", price: 52_000, soldAt: daysAgo(2) },
        { source: "tradera", price: 900_000, soldAt: daysAgo(3) },
      ],
      NOW
    );
    expect(v?.valueOre).toBe(52_000);
  });

  it("ignores zero prices — 0 kr is not a price", () => {
    expect(gradedSoldValue([{ source: "ebay", price: 0, soldAt: daysAgo(1) }], NOW)).toBeNull();
  });
});
