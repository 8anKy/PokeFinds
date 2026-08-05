import { describe, it, expect } from "vitest";
import {
  coverageVerdict,
  COVERAGE_MIN_PRICED_SHARE,
  COVERAGE_STALE_BASELINE,
  COVERAGE_ALLOWED_EMPTY_SETS,
} from "../../src/jobs/cardmarket-refresh";

// Varför vakten finns (2026-07-26): tre hela set (366 singlar) låg utan Cardmarket-data
// i VECKOR och varje körning var grön. En körning som täcker allt och en som missar ett
// helt set ser identiska ut i loggen. Regeln som saknades var inte en matchningsregel —
// det var en LARMREGEL.

// Mätt mot prod 2026-08-05, EFTER att guide-reserven och idProduct-återställningen
// betat av skulden: 777 stillastående offers i juli → 120. Fixturen ska följa
// verkligheten, annars testar den ett läge vi inte längre är i.
const base = {
  emptySets: [],
  totalSingles: 29558,
  coveredSingles: 20721,
  staleOffers: 120,
  pricedThisRun: 20541,
};

describe("coverageVerdict", () => {
  it("normal full körning = grönt", () => {
    expect(coverageVerdict(base)).toEqual({ ok: true, problems: [] });
  });

  it("ett set med singlar men noll CM-offers = rött", () => {
    const v = coverageVerdict({ ...base, emptySets: [{ set: "me5", singles: 120 }] });
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("me5");
    expect(v.problems[0]).toContain("120");
  });

  it("namnger VARJE tomt set, inte bara det första", () => {
    const v = coverageVerdict({
      ...base,
      emptySets: [
        { set: "me5", singles: 120 },
        { set: "me4", singles: 122 },
        { set: "me3", singles: 124 },
      ],
    });
    expect(v.problems).toHaveLength(3);
  });

  it("verifierat tomma set (CM har ingen produkt) tystas av allowlisten", () => {
    const allowed = COVERAGE_ALLOWED_EMPTY_SETS[0];
    expect(allowed).toBeTruthy();
    expect(coverageVerdict({ ...base, emptySets: [{ set: allowed, singles: 10 }] }).ok).toBe(true);
  });

  // HÄNDELSEREGELN: mäts mot katalogens TILLSTÅND, inte mot "i går". Ett
  // historik-backfill 2026-07-25 skrev observationer för 20 153 singlar med deras
  // BEFINTLIGA offer-pris — ett dygnsjämförande mått hade gjort nästa dags helt normala
  // körning röd.
  it("en strukturell förlust i 2026-07-26:s storlek = rött SAMMA dygn", () => {
    // 662 kort föll bort när cards_total under-rapporterade sidantalet.
    const v = coverageVerdict({ ...base, pricedThisRun: base.pricedThisRun - 662 });
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("19879");
    expect(v.problems[0]).toContain("96.5 %");
  });

  it("småskaligt feed-hicka är inte larm", () => {
    const priceable = base.coveredSingles - base.staleOffers;
    expect(coverageVerdict({ ...base, pricedThisRun: Math.ceil(priceable * COVERAGE_MIN_PRICED_SHARE) + 1 }).ok).toBe(true);
  });

  it("en körning som inte prissatte NÅGOT dömer inte (t.ex. bara sealed-fasen)", () => {
    expect(coverageVerdict({ ...base, pricedThisRun: 0 }).ok).toBe(true);
  });

  // TILLSTÅNDSREGELN: ratchet mot en känd skuld. Den var 777 kort i juli och är 120
  // nu — ~81 tryckningar som bara får publiceras med ett ÄKTA From, och ~37 nya
  // SV/SM-promos vars identitet inte går att styrka. Baselinen SÄNKS när skulden
  // betas av; 800 mot en verklighet på 172 var skälet att ingen såg de frusna
  // kurvorna 2026-08-05 (se COVERAGE_STALE_BASELINE).
  it("den KÄNDA skulden ensam är inte ett larm", () => {
    expect(coverageVerdict({ ...base, staleOffers: COVERAGE_STALE_BASELINE }).ok).toBe(true);
  });

  it("ett kort UTÖVER skulden = rött", () => {
    const v = coverageVerdict({
      ...base,
      staleOffers: COVERAGE_STALE_BASELINE + 1,
      pricedThisRun: 19737,
    });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("1 kort UTÖVER"))).toBe(true);
  });

  it("tom katalog kraschar inte", () => {
    expect(
      coverageVerdict({ emptySets: [], totalSingles: 0, coveredSingles: 0, staleOffers: 0, pricedThisRun: 0 })
    ).toEqual({ ok: true, problems: [] });
  });
});
