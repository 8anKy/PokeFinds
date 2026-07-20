import { describe, it, expect } from "vitest";
import {
  foldEngagement,
  computeTrendingLift,
  type EngagementGroupRow,
  type EngagementCount,
} from "@/services/market";

const count = (slug: string, score: number): EngagementCount => ({
  productSlug: slug,
  views: 0,
  clicks: 0,
  searches: 0,
  score,
});

describe("foldEngagement", () => {
  it("viktar vy×1, klick×2, sök×3 och summerar per produkt", () => {
    const rows: EngagementGroupRow[] = [
      { entityId: "kort-a", eventType: "product_view", count: 5 }, // 5
      { entityId: "kort-a", eventType: "list_click", count: 2 }, // 4
      { entityId: "kort-a", eventType: "search_click", count: 1 }, // 3
    ];
    const [a] = foldEngagement(rows);
    expect(a).toEqual({
      productSlug: "kort-a",
      views: 5,
      clicks: 2,
      searches: 1,
      score: 12,
    });
  });

  it("sorterar högst poäng först", () => {
    const rows: EngagementGroupRow[] = [
      { entityId: "lag", eventType: "product_view", count: 3 }, // 3
      { entityId: "hog", eventType: "search_click", count: 4 }, // 12
      { entityId: "mellan", eventType: "list_click", count: 3 }, // 6
    ];
    expect(foldEngagement(rows).map((r) => r.productSlug)).toEqual([
      "hog",
      "mellan",
      "lag",
    ]);
  });

  it("respekterar limit", () => {
    const rows: EngagementGroupRow[] = [
      { entityId: "a", eventType: "search_click", count: 5 },
      { entityId: "b", eventType: "search_click", count: 4 },
      { entityId: "c", eventType: "search_click", count: 3 },
    ];
    expect(foldEngagement(rows, 2).map((r) => r.productSlug)).toEqual(["a", "b"]);
  });

  it("hoppar över rader utan entityId och okända typer", () => {
    const rows: EngagementGroupRow[] = [
      { entityId: null, eventType: "product_view", count: 9 },
      { entityId: "kort", eventType: "retailer_click", count: 9 }, // okänd → poäng 0
      { entityId: "kort", eventType: "product_view", count: 2 }, // 2
    ];
    const result = foldEngagement(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ productSlug: "kort", views: 2, score: 2 });
  });
});

describe("computeTrendingLift", () => {
  const opts = { smoothing: 8, minRecent: 10 };

  it("rankar störst FART (nu vs förra veckan) först, inte störst volym", () => {
    const recent = [count("stadig", 100), count("rusar", 40)];
    const prior = [count("stadig", 100), count("rusar", 2)];
    // stadig: (100+8)/(100+8)=1.0 ; rusar: (40+8)/(2+8)=4.8 → rusar vinner trots lägre volym
    expect(computeTrendingLift(recent, prior, opts).map((r) => r.productSlug)).toEqual([
      "rusar",
      "stadig",
    ]);
  });

  it("golvet stänger ute produkter med för lite intresse just nu", () => {
    const recent = [count("brus", 9), count("akta", 20)];
    const prior: EngagementCount[] = [];
    const result = computeTrendingLift(recent, prior, opts);
    expect(result.map((r) => r.productSlug)).toEqual(["akta"]);
  });

  it("utjämningen hindrar att 0→liten rusar i taket", () => {
    // utan bas: (12+8)/(0+8)=2.5 — dämpat, inte oändligt
    const [r] = computeTrendingLift([count("ny", 12)], [], opts);
    expect(r.lift).toBeCloseTo(2.5, 5);
  });
});
