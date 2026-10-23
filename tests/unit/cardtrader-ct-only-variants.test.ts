import { describe, expect, it } from "vitest";
import { ctOnlyFloorCents, CT_ONLY_VARIANTS } from "@/jobs/cardtrader-ct-only-variants";
import type { CtListing } from "@/lib/cardtrader";

const l = (cents: number, over: Partial<CtListing["properties_hash"]> = {}): CtListing =>
  ({ price: { cents, currency: "EUR" }, quantity: 1, properties_hash: { condition: "Near Mint", pokemon_language: "en", ...over } }) as unknown as CtListing;

describe("ctOnlyFloorCents", () => {
  it("lägsta NM-engelska annonsen när djupet räcker", () => {
    expect(ctOnlyFloorCents([l(2100), l(1927), l(500, { pokemon_language: "it" }), l(300, { condition: "Played" })])).toBe(1927);
  });
  it("null under djupgränsen (en annons är ett utrop, inte ett golv)", () => {
    expect(ctOnlyFloorCents([l(1927)])).toBeNull();
    expect(ctOnlyFloorCents(undefined)).toBeNull();
  });
});

describe("CT_ONLY_VARIANTS", () => {
  it("varje rad bär set, nummer och namn (numret ensamt är aldrig identitet)", () => {
    for (const v of CT_ONLY_VARIANTS) expect(v.setName && v.number && v.cardName && v.label).toBeTruthy();
  });
});
