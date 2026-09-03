import { describe, expect, it } from "vitest";
import {
  canSetListingStatus,
  isTraderaUrl,
  parseKronorToOre,
  validateListing,
  MAX_PRICE_ORE,
} from "@/lib/listing-rules";

describe("validateListing — diskussionsgrupper", () => {
  it("släpper igenom en vanlig tråd utan marknadsfält", () => {
    expect(validateListing({ isMarketplace: false })).toEqual({ ok: true });
    expect(validateListing({ isMarketplace: false, priceOre: 0, condition: "" })).toEqual({
      ok: true,
    });
  });

  it("nekar marknadsfält utanför marknadsgruppen", () => {
    expect(validateListing({ isMarketplace: false, listingKind: "SELL" }).ok).toBe(false);
    expect(validateListing({ isMarketplace: false, priceOre: 12_000 }).ok).toBe(false);
    expect(validateListing({ isMarketplace: false, productId: "p1" }).ok).toBe(false);
    expect(
      validateListing({ isMarketplace: false, traderaUrl: "https://www.tradera.com/item/1" }).ok
    ).toBe(false);
  });
});

describe("validateListing — marknadsgruppen", () => {
  it("kräver en annonstyp", () => {
    const r = validateListing({ isMarketplace: true });
    expect(r.ok).toBe(false);
  });

  it("Säljes kräver pris > 0", () => {
    expect(validateListing({ isMarketplace: true, listingKind: "SELL" }).ok).toBe(false);
    expect(validateListing({ isMarketplace: true, listingKind: "SELL", priceOre: 0 }).ok).toBe(
      false
    );
    expect(validateListing({ isMarketplace: true, listingKind: "SELL", priceOre: -100 }).ok).toBe(
      false
    );
    expect(validateListing({ isMarketplace: true, listingKind: "SELL", priceOre: 4_900 })).toEqual(
      { ok: true }
    );
  });

  it("Köpes får ha pris men behöver inte", () => {
    expect(validateListing({ isMarketplace: true, listingKind: "BUY" })).toEqual({ ok: true });
    expect(validateListing({ isMarketplace: true, listingKind: "BUY", priceOre: 250_000 })).toEqual(
      { ok: true }
    );
  });

  it("Bytes får INTE bära pris", () => {
    expect(validateListing({ isMarketplace: true, listingKind: "TRADE" })).toEqual({ ok: true });
    expect(validateListing({ isMarketplace: true, listingKind: "TRADE", priceOre: 100 }).ok).toBe(
      false
    );
    // null/undefined/0 räknas som "inget pris"
    expect(validateListing({ isMarketplace: true, listingKind: "TRADE", priceOre: null })).toEqual({
      ok: true,
    });
  });

  it("nekar orimliga och icke-heltaliga belopp", () => {
    expect(
      validateListing({ isMarketplace: true, listingKind: "SELL", priceOre: MAX_PRICE_ORE + 1 }).ok
    ).toBe(false);
    expect(validateListing({ isMarketplace: true, listingKind: "SELL", priceOre: 10.5 }).ok).toBe(
      false
    );
    expect(
      validateListing({ isMarketplace: true, listingKind: "SELL", priceOre: MAX_PRICE_ORE })
    ).toEqual({ ok: true });
  });

  it("skicket måste vara en känd nyckel", () => {
    expect(
      validateListing({ isMarketplace: true, listingKind: "BUY", condition: "NEAR_MINT" })
    ).toEqual({ ok: true });
    expect(validateListing({ isMarketplace: true, listingKind: "BUY", condition: "Fint" }).ok).toBe(
      false
    );
    expect(validateListing({ isMarketplace: true, listingKind: "BUY", condition: "" })).toEqual({
      ok: true,
    });
  });

  it("Tradera-länken måste vara https://www.tradera.com/…", () => {
    const base = { isMarketplace: true, listingKind: "SELL" as const, priceOre: 1_000 };
    expect(validateListing({ ...base, traderaUrl: "https://www.tradera.com/item/123" })).toEqual({
      ok: true,
    });
    expect(validateListing({ ...base, traderaUrl: "http://www.tradera.com/item/123" }).ok).toBe(
      false
    );
    expect(validateListing({ ...base, traderaUrl: "https://tradera.com/item/123" }).ok).toBe(false);
    expect(
      validateListing({ ...base, traderaUrl: "https://www.tradera.com.evil.se/item/123" }).ok
    ).toBe(false);
    expect(validateListing({ ...base, traderaUrl: "inte en url" }).ok).toBe(false);
  });
});

describe("isTraderaUrl", () => {
  it("accepterar bara exakt värdnamnet över https", () => {
    expect(isTraderaUrl("https://www.tradera.com/")).toBe(true);
    expect(isTraderaUrl("https://www.tradera.com/item/abc?x=1")).toBe(true);
    expect(isTraderaUrl("https://WWW.TRADERA.COM/item/abc")).toBe(true);
    expect(isTraderaUrl("https://m.tradera.com/item/abc")).toBe(false);
    expect(isTraderaUrl("javascript:alert(1)")).toBe(false);
    expect(isTraderaUrl("")).toBe(false);
  });
});

describe("canSetListingStatus", () => {
  it("ägaren får sätta alla lägen", () => {
    for (const next of ["ACTIVE", "SOLD", "CLOSED"] as const) {
      expect(canSetListingStatus({ isOwner: true, isModerator: false, next })).toBe(true);
    }
  });
  it("moderatorn får bara stänga", () => {
    expect(canSetListingStatus({ isOwner: false, isModerator: true, next: "CLOSED" })).toBe(true);
    expect(canSetListingStatus({ isOwner: false, isModerator: true, next: "SOLD" })).toBe(false);
    expect(canSetListingStatus({ isOwner: false, isModerator: true, next: "ACTIVE" })).toBe(false);
  });
  it("andra får ingenting", () => {
    expect(canSetListingStatus({ isOwner: false, isModerator: false, next: "CLOSED" })).toBe(false);
  });
});

describe("parseKronorToOre", () => {
  it("läser svenska belopp", () => {
    expect(parseKronorToOre("1 250")).toBe(125_000);
    expect(parseKronorToOre("99,50")).toBe(9_950);
    expect(parseKronorToOre("99.5")).toBe(9_950);
    expect(parseKronorToOre("0")).toBe(0);
  });
  it("null för skräp", () => {
    expect(parseKronorToOre("")).toBeNull();
    expect(parseKronorToOre("abc")).toBeNull();
    expect(parseKronorToOre("12,345")).toBeNull();
    expect(parseKronorToOre("-5")).toBeNull();
  });
});
