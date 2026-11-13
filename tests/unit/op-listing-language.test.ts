import { describe, expect, it } from "vitest";
import {
  isConfirmedEnglish,
  mergeOpLanguageCache,
  OP_LANGUAGE_KEEP_MS,
  orderPendingByPriceRank,
  parseOpLanguageCache,
  settledVerdict,
  traderaPhotoUrl,
} from "@/lib/op-listing-language";

describe("parseOpLanguageCache", () => {
  it("läser giltiga rader och kastar resten", () => {
    const c = parseOpLanguageCache(
      JSON.stringify({ a: { v: "en", d: 0.31, n: 80, t: 5 }, b: { v: "kanske" }, c: "x", d: { v: "jp" } })
    );
    expect(Object.keys(c)).toEqual(["a", "d"]);
    expect(c.d).toEqual({ v: "jp", d: 0, n: 0, t: 0 });
  });
  it("trasig fil ⇒ tom cache, aldrig ett kast", () => {
    expect(parseOpLanguageCache("{")).toEqual({});
    expect(parseOpLanguageCache("[1]")).toEqual({});
    expect(parseOpLanguageCache(null)).toEqual({});
  });
});

describe("domen", () => {
  const cache = parseOpLanguageCache(
    JSON.stringify({ en: { v: "en" }, jp: { v: "jp" }, oklar: { v: "unclear" }, fel: { v: "error" } })
  );
  it("⛔ bara ett bevisat engelskt kort får sätta pris", () => {
    expect(isConfirmedEnglish(cache, "en")).toBe(true);
    for (const id of ["jp", "oklar", "fel", "okänd"]) expect(isConfirmedEnglish(cache, id)).toBe(false);
  });
  it("ett nätfel är ingen dom — annonsen prövas om", () => {
    expect(settledVerdict(cache, "fel")).toBeNull();
    expect(settledVerdict(cache, "okänd")).toBeNull();
    expect(settledVerdict(cache, "oklar")).toBe("unclear");
  });
});

describe("traderaPhotoUrl", () => {
  it("miniatyren → fullstora bilden", () => {
    expect(traderaPhotoUrl("https://img.tradera.net/thumbs/063/635577063_b95e.jpg")).toBe(
      "https://img.tradera.net/images/063/635577063_b95e.jpg"
    );
    expect(traderaPhotoUrl("https://exempel.se/thumbs/x.jpg")).toBeNull();
    expect(traderaPhotoUrl(undefined)).toBeNull();
  });
});

describe("orderPendingByPriceRank", () => {
  it("varje produkts billigaste annons prövas före någons näst billigaste", () => {
    const order = orderPendingByPriceRank([
      { productId: "a", priceOre: 900, id: "a2" },
      { productId: "a", priceOre: 100, id: "a1" },
      { productId: "b", priceOre: 5000, id: "b1" },
      { productId: "b", priceOre: 6000, id: "b2" },
    ]).map((x) => x.id);
    expect(order).toEqual(["a1", "b1", "a2", "b2"]);
  });
});

describe("mergeOpLanguageCache", () => {
  const now = 1_000 * 24 * 3600_000;
  it("nya domar in, sedda hålls vid liv, gamla osedda åldras ut", () => {
    const old = { v: "en" as const, d: 0.3, n: 50, t: now - OP_LANGUAGE_KEEP_MS - 1 };
    const merged = mergeOpLanguageCache(
      { sedd: old, borta: old, färsk: { ...old, t: now - 1000 } },
      { ny: { v: "jp", d: -0.2, n: 40 }, skräp: { v: "?" } },
      new Set(["sedd"]),
      now
    );
    expect(Object.keys(merged).sort()).toEqual(["färsk", "ny", "sedd"]);
    expect(merged.sedd.t).toBe(now);
    expect(merged.ny).toEqual({ v: "jp", d: -0.2, n: 40, t: now });
  });
});
