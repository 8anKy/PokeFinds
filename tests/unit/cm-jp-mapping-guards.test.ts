/**
 * JP-auto-mappningens vakter (2026-08-10).
 *
 * Bakgrund: "Storm Emeralda Booster Box (Japansk)" (dubblettstub) auto-mappades
 * till Cardmarkets KINESISKA "CSM1aC: Storming Emergence - Radiant Booster Box",
 * och pack-stubben till "Tidal Storm Booster" — fel identitet, fel pris och två
 * skräp-set. Roten: ownedBy-filtret tog bort det RÄTTA svaret (ägt av tvillingen)
 * ur poolen innan likheten jämfördes, så närmaste oägda lookalike vann.
 */
import { describe, expect, it } from "vitest";
import { isCmChineseName } from "../../src/jobs/cardmarket-refresh";

describe("isCmChineseName", () => {
  it("fäller den observerade kinesiska kodfamiljen (CS…C med kolon)", () => {
    expect(isCmChineseName("CSM1aC: Storming Emergence - Radiant Booster Box")).toBe(true);
    expect(isCmChineseName("CSM1aC: Storming Emergence - Radiant Booster")).toBe(true);
    expect(isCmChineseName("CS1aC: Something Booster Box")).toBe(true);
  });

  it("släpper äkta EN/JP-katalognamn — inklusive kinesiska utgåvor UTAN kod (tvillingvaktens jobb)", () => {
    expect(isCmChineseName("Storm Emeralda Booster Box")).toBe(false);
    expect(isCmChineseName("Shocking Volt Tackle Booster Box")).toBe(false);
    expect(isCmChineseName("VMAX Climax Booster")).toBe(false);
    expect(isCmChineseName("30th Celebration JP Booster")).toBe(false);
    expect(isCmChineseName("Crown Zenith Booster")).toBe(false);
    // "Tidal Storm Booster" är kinesisk men bär ingen kod — den fångas av
    // tvillingvakten (ägd twin med högre likhet), inte av namnmönstret.
    expect(isCmChineseName("Tidal Storm Booster")).toBe(false);
  });
});
