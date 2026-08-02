import { describe, expect, it } from "vitest";
import { parseKronorToOre } from "@/lib/purchase-price";

describe("parseKronorToOre", () => {
  it("skiljer BLANKT från noll — blankt = vet inte, 0 = köpt gratis", () => {
    expect(parseKronorToOre("")).toEqual({ kind: "empty" });
    expect(parseKronorToOre("   ")).toEqual({ kind: "empty" });
    expect(parseKronorToOre("0")).toEqual({ kind: "ok", ore: 0 });
  });

  it("tar både komma och punkt som decimaltecken", () => {
    // Svenska tangentbord ger komma — det är normalfallet, inte undantaget.
    expect(parseKronorToOre("249,50")).toEqual({ kind: "ok", ore: 24950 });
    expect(parseKronorToOre("249.50")).toEqual({ kind: "ok", ore: 24950 });
    expect(parseKronorToOre(",5")).toEqual({ kind: "ok", ore: 50 });
    expect(parseKronorToOre("12,")).toEqual({ kind: "ok", ore: 1200 });
  });

  it("tål klistrat innehåll: tusentalsavskiljare och kr-suffix", () => {
    expect(parseKronorToOre("1 234,50")).toEqual({ kind: "ok", ore: 123450 });
    expect(parseKronorToOre("1 234,50")).toEqual({ kind: "ok", ore: 123450 });
    expect(parseKronorToOre("1 234,50")).toEqual({ kind: "ok", ore: 123450 });
    expect(parseKronorToOre("249,50 kr")).toEqual({ kind: "ok", ore: 24950 });
    expect(parseKronorToOre("249,50 SEK")).toEqual({ kind: "ok", ore: 24950 });
  });

  it("avvisar negativa priser i stället för att tolka dem som 0", () => {
    expect(parseKronorToOre("-1")).toEqual({ kind: "invalid" });
    expect(parseKronorToOre("-0,01")).toEqual({ kind: "invalid" });
  });

  it("avvisar skräp och mer precision än ett öre", () => {
    expect(parseKronorToOre("abc")).toEqual({ kind: "invalid" });
    expect(parseKronorToOre(".")).toEqual({ kind: "invalid" });
    expect(parseKronorToOre("1,234")).toEqual({ kind: "invalid" });
    expect(parseKronorToOre("1,2,3")).toEqual({ kind: "invalid" });
  });

  it("avvisar belopp över int4 — annars blir felskrivningen ett 500 från Postgres", () => {
    expect(parseKronorToOre("999999999999")).toEqual({ kind: "invalid" });
    // Precis under taket (20 000 000 kr) ska fortfarande gå igenom.
    expect(parseKronorToOre("20000000")).toEqual({ kind: "ok", ore: 2_000_000_000 });
  });

  it("rundar till heltal öre — aldrig float in i databasen", () => {
    const parsed = parseKronorToOre("19,99");
    expect(parsed).toEqual({ kind: "ok", ore: 1999 });
    expect(Number.isInteger((parsed as { ore: number }).ore)).toBe(true);
  });
});
