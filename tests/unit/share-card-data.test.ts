import { describe, it, expect } from "vitest";
import { shareChartWindow, shareChangeFromPercent, shareChangeOverDays } from "@/lib/share-card-data";

const pt = (date: string, kr: number) => ({ date, price: kr * 100 });

describe("shareChartWindow", () => {
  it("räknar fönstret från seriens sista punkt, inte från i dag", () => {
    const series = [pt("2026-01-01", 10), pt("2026-03-01", 20), pt("2026-05-01", 30), pt("2026-05-30", 40)];
    const w = shareChartWindow(series, 90);
    expect(w.points.map((p) => p.date)).toEqual(["2026-03-01", "2026-05-01", "2026-05-30"]);
    expect(w.days).toBe(90);
  });

  it("lovar aldrig fler dagar än datat täcker", () => {
    const w = shareChartWindow([pt("2026-05-20", 10), pt("2026-05-27", 12)], 90);
    expect(w.days).toBe(7);
  });

  it("släpper nollor — 0 kr är inget pris", () => {
    const w = shareChartWindow([pt("2026-05-20", 0), pt("2026-05-21", 10), pt("2026-05-22", 12)], 90);
    expect(w.points).toHaveLength(2);
  });

  it("tom serie ⇒ ingen graf", () => {
    expect(shareChartWindow([], 90)).toEqual({ points: [], days: 0 });
  });
});

describe("shareChangeFromPercent", () => {
  it("formaterar med tecken och riktning", () => {
    expect(shareChangeFromPercent(4.24, "senaste 30 dagarna")).toEqual({
      text: "+4,2 %",
      period: "senaste 30 dagarna",
      up: true,
    });
    expect(shareChangeFromPercent(-15.9, "p")?.up).toBe(false);
  });

  it("ingen rad för okänt eller noll", () => {
    expect(shareChangeFromPercent(null, "p")).toBeNull();
    expect(shareChangeFromPercent(0.04, "p")).toBeNull();
    expect(shareChangeFromPercent(Number.NaN, "p")).toBeNull();
  });
});

describe("shareChangeOverDays", () => {
  it("sista punkten mot första i fönstret, som samlingens hero", () => {
    const series = [pt("2026-04-01", 50), pt("2026-05-01", 100), pt("2026-05-31", 110)];
    expect(shareChangeOverDays(series, 30, "p")?.text).toBe("+10,0 %");
  });

  it("en enda punkt i fönstret ger ingen förändring", () => {
    expect(shareChangeOverDays([pt("2026-04-01", 50), pt("2026-05-31", 110)], 30, "p")).toBeNull();
  });
});
