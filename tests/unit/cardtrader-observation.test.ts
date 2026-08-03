import { describe, it, expect } from "vitest";
import { shouldRecord, CT_MAX_GAP_DAYS } from "@/jobs/cardtrader-observation";
import { fillForward } from "@/services/products";

// Skriv-vid-ändring och fill-forward är TVÅ HALVOR AV SAMMA REGEL: den ena hoppar
// över ett skriv när priset står stilla, den andra ritar tillbaka de dagarna. De
// delar `CT_MAX_GAP_DAYS` med flit — glider talen isär börjar grafen dikta över
// driftstopp i stället för att lämna hålet.

const NOW = new Date("2026-08-10T06:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("shouldRecord", () => {
  it("aldrig sett förut → skriv", () => {
    expect(shouldRecord(null, 500, NOW)).toBe("new");
  });

  it("ändrat pris → skriv", () => {
    expect(shouldRecord({ price: 400, observedAt: daysAgo(1) }, 500, NOW)).toBe("changed");
  });

  it("samma pris inom hjärtslaget → skriv INTE (det är hela besparingen)", () => {
    expect(shouldRecord({ price: 500, observedAt: daysAgo(1) }, 500, NOW)).toBeNull();
    expect(shouldRecord({ price: 500, observedAt: daysAgo(6) }, 500, NOW)).toBeNull();
  });

  it("samma pris men tystnaden har nått hjärtslaget → skriv ändå", () => {
    // Utan detta går "stod stilla" inte att skilja från "jobbet dog".
    expect(shouldRecord({ price: 500, observedAt: daysAgo(CT_MAX_GAP_DAYS) }, 500, NOW)).toBe("heartbeat");
    expect(shouldRecord({ price: 500, observedAt: daysAgo(30) }, 500, NOW)).toBe("heartbeat");
  });

  it("ett pris på 0 är ett ÄNDRAT pris, inte 'saknas'", () => {
    expect(shouldRecord({ price: 500, observedAt: daysAgo(1) }, 0, NOW)).toBe("changed");
  });
});

describe("fillForward", () => {
  const p = (date: string, price: number) => ({ date, price });

  it("ägarens exempel: 10 den 1:a, 12 den 5:e → 2–4 ritas som 10", () => {
    const out = fillForward([p("2026-08-01", 1000), p("2026-08-05", 1200)], new Date("2026-08-05T12:00:00Z"));
    expect(out).toEqual([
      p("2026-08-01", 1000),
      p("2026-08-02", 1000),
      p("2026-08-03", 1000),
      p("2026-08-04", 1000),
      p("2026-08-05", 1200),
    ]);
  });

  it("sista punkten sträcks fram till IDAG — priset gäller tills annat sagts", () => {
    const out = fillForward([p("2026-08-08", 700)], new Date("2026-08-10T09:00:00Z"));
    expect(out).toEqual([p("2026-08-08", 700), p("2026-08-09", 700), p("2026-08-10", 700)]);
  });

  it("⛔ LÅNGA LUCKOR LÄMNAS ÖPPNA — de är driftstopp, inte stillastående pris", () => {
    // 20 dygn utan punkt kan inte vara "oförändrat": hjärtslaget hade skrivit en.
    const out = fillForward([p("2026-07-01", 900), p("2026-07-21", 950)], new Date("2026-07-21T12:00:00Z"));
    expect(out).toEqual([p("2026-07-01", 900), p("2026-07-21", 950)]);
  });

  it("gränsen är exakt CT_MAX_GAP_DAYS dygn", () => {
    const within = fillForward([p("2026-08-01", 100), p("2026-08-08", 200)], new Date("2026-08-08T12:00:00Z"));
    expect(within).toHaveLength(8); // 1:a + 6 ifyllda + 8:e
    const beyond = fillForward([p("2026-08-01", 100), p("2026-08-09", 200)], new Date("2026-08-09T12:00:00Z"));
    expect(beyond).toHaveLength(2);
  });

  it("tom serie och sammanhängande serie lämnas orörda", () => {
    expect(fillForward([], NOW)).toEqual([]);
    const dense = [p("2026-08-09", 1), p("2026-08-10", 2)];
    expect(fillForward(dense, new Date("2026-08-10T12:00:00Z"))).toEqual(dense);
  });

  it("en gammal serie sträcks INTE ända fram till idag", () => {
    // Produkten föll ur CardTrader i maj → grafen ska sluta där, inte låtsas leva.
    const out = fillForward([p("2026-05-01", 400)], NOW);
    expect(out).toEqual([p("2026-05-01", 400)]);
  });
});
