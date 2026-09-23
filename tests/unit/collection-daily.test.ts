import { describe, expect, it } from "vitest";
import { computeDailyChange, type DailyItem } from "@/lib/collection-daily";

const NOW = new Date("2026-09-24T10:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const item = (over: Partial<DailyItem>): DailyItem => ({
  id: "a",
  name: "Mega Darkrai ex",
  quantity: 1,
  current: 11_000,
  ownedFrom: day("2026-09-01").getTime(),
  snaps: [
    { date: day("2026-09-23"), avgPrice: 100 },
    { date: day("2026-09-24"), avgPrice: 110 },
  ],
  ...over,
});

describe("computeDailyChange", () => {
  it("ankras i nuvärdet: +10 % trend på 110 kr ⇒ +10 kr", () => {
    const r = computeDailyChange([item({})], NOW)!;
    expect(r.deltaOre).toBe(1_000);
    expect(r.percent).toBe(10);
    expect(r.movers).toEqual([{ id: "a", name: "Mega Darkrai ex", deltaOre: 1_000 }]);
  });

  it("antal multiplicerar och största rörelsen (upp eller ned) står först", () => {
    const r = computeDailyChange(
      [
        item({ id: "up", quantity: 2 }),
        item({
          id: "down",
          name: "Pikachu ex",
          current: 50_000,
          snaps: [
            { date: day("2026-09-23"), avgPrice: 100 },
            { date: day("2026-09-24"), avgPrice: 90 },
          ],
        }),
      ],
      NOW
    )!;
    expect(r.movers.map((m) => m.id)).toEqual(["down", "up"]);
    expect(r.movers[1].deltaOre).toBe(2_000);
    expect(r.movers[0].deltaOre).toBeLessThan(0);
  });

  it("räknar inte det som inte går att mäta", () => {
    const stale = item({ snaps: [{ date: day("2026-09-20"), avgPrice: 100 }, { date: day("2026-09-21"), avgPrice: 110 }] });
    const gap = item({ snaps: [{ date: day("2026-09-21"), avgPrice: 100 }, { date: day("2026-09-24"), avgPrice: 110 }] });
    const newlyAdded = item({ ownedFrom: day("2026-09-24").getTime() });
    const oneSnap = item({ snaps: [{ date: day("2026-09-24"), avgPrice: 110 }] });
    expect(computeDailyChange([stale, gap, newlyAdded, oneSnap], NOW)).toBeNull();
  });

  it("igår som senaste prisdag räknas (prisjobbet har inte kört idag än)", () => {
    const r = computeDailyChange(
      [item({ snaps: [{ date: day("2026-09-22"), avgPrice: 100 }, { date: day("2026-09-23"), avgPrice: 110 }] })],
      NOW
    );
    expect(r?.deltaOre).toBe(1_000);
  });

  it("samma vara i flera poster blir EN rad", () => {
    const r = computeDailyChange(
      [item({ id: "lot1", groupKey: "etb" }), item({ id: "lot2", groupKey: "etb", quantity: 2 })],
      NOW
    )!;
    expect(r.movers).toEqual([{ id: "lot1", name: "Mega Darkrai ex", deltaOre: 3_000 }]);
    expect(r.measured).toBe(2);
  });

  it("oförändrat ger 0 och inga rörelser", () => {
    const flat = item({ snaps: [{ date: day("2026-09-23"), avgPrice: 100 }, { date: day("2026-09-24"), avgPrice: 100 }] });
    const r = computeDailyChange([flat], NOW)!;
    expect(r.deltaOre).toBe(0);
    expect(r.movers).toEqual([]);
  });
});
