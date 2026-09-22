import { describe, expect, it } from "vitest";
import { subsetAliasExternalIds } from "@/lib/subset-number-alias";

/**
 * 30th Celebration-Pikachu bär både setets nummer (#51) och underseriens
 * ("29/30"). Mätt: 51 domar pekade på #N+22, 3 (alla masstryck) på #N.
 */
describe("subsetAliasExternalIds", () => {
  it("'29/30' pekar också på 30th Celebration #51", () => {
    expect(subsetAliasExternalIds({ num: 29, total: 30 })).toEqual(["me55-51"]);
    expect(subsetAliasExternalIds({ num: 1, total: 30 })).toEqual(["me55-23"]);
    expect(subsetAliasExternalIds({ num: 30, total: 30 })).toEqual(["me55-52"]);
  });
  it("ingen alias utan rätt total eller utanför serien", () => {
    expect(subsetAliasExternalIds({ num: 29, total: 128 })).toEqual([]);
    expect(subsetAliasExternalIds({ num: 29, total: null })).toEqual([]);
    expect(subsetAliasExternalIds({ num: 31, total: 30 })).toEqual([]);
    expect(subsetAliasExternalIds({ num: 0, total: 30 })).toEqual([]);
    expect(subsetAliasExternalIds(null)).toEqual([]);
  });
});
