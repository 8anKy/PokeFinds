/**
 * FUN PACK ÄR EN EGEN FORM (2026-11-23).
 *
 * "Fun Pack (3 Cards)" saknade form (null), formvakten släppte igenom allt, och produkten blev
 * setets magnet: 25 av 31 butiksoffers på fun packs var checklane-blistrar, 3-pack-blistrar och en
 * tin. SF-Boks "Pokemon TCG: Mega Evolution Tin" (499 kr) kopplades till "Mega Evolution Fun Pack
 * (3 Cards)" och Discord-inlägget sa "36 % under marknadsvärdet".
 */
import { describe, expect, it } from "vitest";
import { classifyForm, matchProduct, type MatchIndex } from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";

const product = (id: string, title: string, category: string): MatchIndex[number] =>
  ({ id, title, normalizedTitle: normalizeTitle(title), category, language: "EN", game: "POKEMON" }) as unknown as MatchIndex[number];

const index: MatchIndex = [
  product("fun-me", "Mega Evolution Fun Pack (3 Cards)", "BOOSTER_PACK"),
  product("fun-dr", "Delta Reign Fun Pack (3 Cards)", "BOOSTER_PACK"),
  product("fun-sv", "Scarlet & Violet Fun Pack (3 Cards)", "BOOSTER_PACK"),
];

const match = async (title: string) => (await matchProduct(normalizeTitle(title), index, title))?.productId ?? null;

describe("Fun Pack / Sampling Pack har en egen form", () => {
  it("klassas som funpack, inte formlös", () => {
    expect(classifyForm("Mega Evolution Fun Pack (3 Cards)")).toBe("funpack");
    expect(classifyForm("Burning Shadows Sampling Pack (3 Cards)")).toBe("funpack");
    expect(classifyForm("Pokemon Sword & Shield 9: Brilliant Stars Booster Fun Pack")).toBe("funpack");
  });

  it("en tin eller en checklane-blister kopplas aldrig till setets fun pack", async () => {
    expect(await match("Pokemon TCG: Mega Evolution Tin")).toBeNull();
    expect(await match("Delta Reign Premium Checklane")).toBeNull();
    expect(await match("Pokemon ME06 Delta Reign Checklane Blister Booster")).toBeNull();
  });

  it("en butiks fun pack hittar fortfarande katalogens fun pack", async () => {
    expect(await match("Pokemon Scarlet & Violet Fun Pack")).toBe("fun-sv");
  });
});
