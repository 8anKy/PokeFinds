import { describe, expect, it } from "vitest";
import {
  webhallenMinRankLevel,
  webhallenStoreBreakdown,
  webhallenStoreOnly,
} from "@/scrapers/adapters/webhallen-adapter";

// 2026-09-23: 30th Celebration fick ett kort webblager 12:57 UTC medan sidan sa "kan
// endast hämtas i butik" — lanen postade alla sex varorna i ONLINE-kanalerna.
const released = { timestamp: Math.floor(Date.now() / 1000) - 7 * 86400 };
const base = { id: 1, name: "Pokemon 30th Celebration Elite Trainer Box", price: null, release: released };

describe("Webhallen: hämtas-bara-i-butik och medlemsnivå", () => {
  it("⛔ webblager på en vara som inte går att skicka är en BUTIKSVARA", () => {
    expect(webhallenStoreOnly({ ...base, isShippable: false, stock: { web: 3, "2": 4 } })).toBe(true);
  });
  it("vanligt webblager (skickbart eller okänt) är online", () => {
    expect(webhallenStoreOnly({ ...base, isShippable: true, stock: { web: 3 } })).toBe(false);
    expect(webhallenStoreOnly({ ...base, stock: { web: 3 } })).toBe(false);
  });
  it("slut överallt är ingen butiksvara", () => {
    expect(webhallenStoreOnly({ ...base, isShippable: false, stock: { web: 0, "2": 0 } })).toBe(false);
  });
  it("nivåkravet: 1 = alla, högre visas", () => {
    expect(webhallenMinRankLevel({ ...base, minimumRankLevel: 9 })).toBe(9);
    expect(webhallenMinRankLevel({ ...base, minimumRankLevel: 1 })).toBeNull();
    expect(webhallenMinRankLevel({ ...base })).toBeNull();
  });
  it("byStore bär ALLA butiker, nollor inräknade; locations bär id", () => {
    const s = webhallenStoreBreakdown(
      { web: 0, displayCap: 50, "2": 3, "15": 0 },
      new Map([[2, { id: 2, name: "Farsta Centrum", city: "Stockholm" }]])
    );
    expect(s.byStore).toEqual({ "2": 3, "15": 0 });
    expect(s.locations?.[0]).toMatchObject({ id: "2", units: 3 });
  });
});
