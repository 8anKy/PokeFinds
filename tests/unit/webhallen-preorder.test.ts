import { describe, it, expect } from "vitest";
import { webhallenStockStatus } from "@/scrapers/adapters/webhallen-adapter";

// Minimal WebhallenProduct-form; bara fälten webhallenStockStatus läser spelar roll.
const item = (stockWeb: number, releaseTs?: number) =>
  ({ id: 1, name: "x", price: { price: "1", currency: "SEK" }, stock: { web: stockWeb }, release: releaseTs != null ? { timestamp: releaseTs } : null }) as never;

const future = Math.floor(Date.now() / 1000) + 30 * 86400;
const past = Math.floor(Date.now() / 1000) - 30 * 86400;

describe("webhallenStockStatus", () => {
  it("web-lager > 0 = i lager (även med framtida release)", () => {
    expect(webhallenStockStatus(item(5, future))).toBe("IN_STOCK");
  });
  it("inget lager + framtida release = förhandsbokning", () => {
    expect(webhallenStockStatus(item(0, future))).toBe("PREORDER");
  });
  it("inget lager + passerad release = ur lager", () => {
    expect(webhallenStockStatus(item(0, past))).toBe("OUT_OF_STOCK");
  });
  it("inget lager + inget release-datum = ur lager", () => {
    expect(webhallenStockStatus(item(0))).toBe("OUT_OF_STOCK");
  });
});
