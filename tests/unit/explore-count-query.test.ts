import { describe, it, expect } from "vitest";
import { countQuery } from "../../src/lib/explore-count-query";

const parse = (s: string) => Object.fromEntries(new URLSearchParams(s).entries());

describe("countQuery", () => {
  it("döper om URL:ens svenska fält till API:ts", () => {
    expect(
      parse(countQuery({ q: "charizard", kategori: "ETB,TIN", set: "s1", butik: "r1,r2", sprak: "EN" }))
    ).toEqual({
      query: "charizard",
      category: "ETB,TIN",
      setId: "s1",
      retailerId: "r1,r2",
      language: "EN",
    });
  });

  it("KRONOR → ÖRE (annars blir intervallet 100x för snävt)", () => {
    expect(parse(countQuery({ minKr: 200, maxKr: 1500 }))).toEqual({
      minPrice: "20000",
      maxPrice: "150000",
    });
  });

  it("pågående val i sheeten vinner över det som redan ligger i URL:en", () => {
    expect(parse(countQuery({ minPris: "100", maxPris: "500", minKr: 0, maxKr: 250 }))).toEqual({
      maxPrice: "25000",
    });
  });

  it("inget tak (maxKr = null) skickar ingen maxPrice — inte 0", () => {
    const q = parse(countQuery({ minKr: 1000, maxKr: null }));
    expect(q).toEqual({ minPrice: "100000" });
    expect(q.maxPrice).toBeUndefined();
  });

  it("lager=1 blir stockStatus, andra värden ignoreras", () => {
    expect(parse(countQuery({ lager: "1" }))).toEqual({ stockStatus: "IN_STOCK" });
    expect(parse(countQuery({ lager: "0" }))).toEqual({});
  });

  it("tomt urval ger tom frågesträng (= hela katalogen)", () => {
    expect(countQuery({})).toBe("");
    expect(countQuery({ minKr: 0, maxKr: null, q: "" })).toBe("");
  });

  it("skräp i prisfälten smittar inte frågan", () => {
    expect(parse(countQuery({ minPris: "abc", maxPris: "abc" }))).toEqual({});
  });
});
