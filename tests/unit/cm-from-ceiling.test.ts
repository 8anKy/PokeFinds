import { describe, it, expect } from "vitest";
import { singlesHeadlineEur } from "@/jobs/cardmarket-refresh";

/**
 * REGRESSION 2026-07-27 — guiden får aldrig överpröva feedens NM-engelska lägsta.
 *
 * Två vakter byggda på CM:s öppna prisguide (price_guide_6.json) bytte ut
 * `lowest_near_mint` mot ett guide-värde. Båda publicerade priser som inte fanns
 * någonstans på Cardmarket, och båda revs samma dag:
 *
 *   TAKET   From > max(guidens sex fält) × 2,5  →  medianen av fälten
 *   GOLVET  From < guidens low × 0,5            →  guidens low
 *
 * Facit-felet är mätbart och står kvar i produktionsdata: för Rayquaza Gold Star
 * (idProduct 276510) säger guiden low = 2 900 € medan CM:s EGEN produktsida samma
 * dag visar From 37 000 € för NM+engelska — precis vad feeden sa. Guidens `low` är
 * alltså inte produktens lägsta annons, och en vakt vars facit är osant dömer ut
 * sanningen.
 *
 * Den här filen finns för att fånga varje framtida försök att återinföra dem.
 */

// Rayquaza ★ · Deoxys 107/107 — kortet ägaren såg 215,61 kr på.
const RAYQUAZA_GUIDE = { low: 2900, trend: 6271.49, avg: 9800, avg1: 9800, avg7: 4931.25, avg30: 4093.09 };
const RAYQUAZA_FROM = 37000; // CM:s produktsida, filtren NM + engelska

// Ponyta · Base Set 60 — fallet som motiverade taket.
const PONYTA_GUIDE = { low: 1.25, trend: 3.41, avg: 2.45, avg1: 7.64, avg7: 6.38, avg30: 8.01 };

describe("singlesHeadlineEur — feedens From är okränkbar", () => {
  it("Rayquaza: 37 000 € publiceras trots att det ligger 3,8x över guidens högsta fält", () => {
    // Taket hade skrivit medianen 5 601,37 € här; audit-skriptet skrev 19,50 € (215,61 kr).
    expect(singlesHeadlineEur({ from: RAYQUAZA_FROM, avg30: 4093.09 }, RAYQUAZA_GUIDE)).toEqual({
      eur: RAYQUAZA_FROM,
      from: true,
      via: "from",
    });
  });

  it("Ponyta: 25,66 € står kvar — mittpunkten var en gissning, inte ett facit", () => {
    expect(singlesHeadlineEur({ from: 25.66, avg30: 8.01 }, PONYTA_GUIDE)).toEqual({
      eur: 25.66,
      from: true,
      via: "from",
    });
  });

  it("ett lågt From står också kvar — guidens low får inte ersätta det", () => {
    // Brock's Scouting-klassen (LNM 0,02 € mot guidens low 1,25 €). Samma mekanism
    // publicerade en SEALED-produkts golv som Pidgeys pris (3 262 kr).
    expect(
      singlesHeadlineEur({ from: 0.02, avg30: 3.2 }, { low: 1.25, trend: 1.4, avg: 1.5, avg30: 1.45 })
    ).toEqual({ eur: 0.02, from: true, via: "from" });
  });

  it("utan guide-rad: oförändrat, From rakt av", () => {
    expect(singlesHeadlineEur({ from: 25.66, avg30: null }, null)).toEqual({
      eur: 25.66,
      from: true,
      via: "from",
    });
  });

  it("bara `from` avgör — guide-raden kan inte ändra utfallet åt något håll", () => {
    const feed = { from: 12.5, avg30: 40 };
    const withGuide = singlesHeadlineEur(feed, { low: 90, trend: 88, avg: 91, avg1: 95, avg7: 89, avg30: 87 });
    const without = singlesHeadlineEur(feed, null);
    expect(withGuide).toEqual(without);
    expect(withGuide).toEqual({ eur: 12.5, from: true, via: "from" });
  });
});

describe("singlesHeadlineEur — guiden får bara fylla ett tomrum", () => {
  it("From saknas → median-uppskattning märkt OUT_OF_STOCK", () => {
    const r = singlesHeadlineEur({ from: null, avg30: 3.04 }, { trend: 2.3, avg: 2.31, avg30: 3.04 })!;
    expect(r.from).toBe(false);
    expect(r.via).toBe("estimate");
  });

  it("inget att gå på → null (inget skrivs)", () => {
    expect(singlesHeadlineEur({ from: null, avg30: null }, null)).toBeNull();
    expect(singlesHeadlineEur({ from: 0, avg30: 0 }, { low: 0, trend: 0, avg30: 0 })).toBeNull();
  });
});
