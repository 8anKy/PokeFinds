import { describe, expect, it } from "vitest";
import { linkReportHint } from "@/lib/link-report-hint";

const base = { reason: "WRONG_PRODUCT", stockStatus: "IN_STOCK", storeTitle: null as string | null, productTitle: "Chaos Rising Booster Box", gtinMismatch: false };

describe("linkReportHint — beviset bredvid anmälan", () => {
  it("halvboxen på hela boxen är bevisat fel (de riktiga anmälningarna 2026-11)", () => {
    expect(linkReportHint({ ...base, storeTitle: "Pokémon Mega Evolution: Chaos Rising Half Booster Box" })?.tone).toBe("wrong");
    expect(linkReportHint({ ...base, storeTitle: "Pokémon, Mega Evolutions, ME04: Chaos Rising, Half Display / Booster Box" })?.tone).toBe("wrong");
  });

  it("olika streckkoder är bevisat fel oavsett anmälans skäl", () => {
    expect(linkReportHint({ ...base, reason: "WRONG_PRICE", gtinMismatch: true })?.tone).toBe("wrong");
  });

  it("\"slut i lager\" som redan står som slut hos oss är inaktuell; annars ska admin titta", () => {
    expect(linkReportHint({ ...base, reason: "OUT_OF_STOCK", stockStatus: "OUT_OF_STOCK" })?.tone).toBe("resolved");
    expect(linkReportHint({ ...base, reason: "OUT_OF_STOCK", stockStatus: "IN_STOCK" })?.tone).toBe("check");
  });

  it("gissar aldrig: en vanlig \"fel produkt\" är en uppmaning att jämföra, ett prisklagomål ger inget", () => {
    expect(linkReportHint({ ...base, storeTitle: "Pokémon TCG: Chaos Rising Booster Box" })?.tone).toBe("check");
    expect(linkReportHint({ ...base })?.tone).toBe("check");
    expect(linkReportHint({ ...base, reason: "WRONG_PRICE" })).toBeNull();
  });
});
