import { describe, it, expect } from "vitest";
import { webhallenStockStatus, webhallenStoreStock } from "@/scrapers/adapters/webhallen-adapter";

// Minimal WebhallenProduct-form; bara fälten webhallenStockStatus läser spelar roll.
const item = (stockWeb: number, releaseTs?: number, stores: Record<string, number> = {}) =>
  ({ id: 1, name: "x", price: { price: "1", currency: "SEK" }, stock: { web: stockWeb, ...stores }, release: releaseTs != null ? { timestamp: releaseTs } : null }) as never;

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

  // BUTIKSSLÄPP (30th Celebration 2026-09-19): web=0, isShippable=false, men butikerna
  // bär saldo. Ägarbeslut: butiksvara = i lager (som SF-Bok).
  it("web=0 men butikssaldo efter släppet = i lager (butiksvara)", () => {
    expect(webhallenStockStatus(item(0, past, { "2": 48, "5": 51, "27": 0 }))).toBe("IN_STOCK");
  });
  it("web=0 + butikssaldo men FRAMTIDA release = fortfarande förhandsbokning", () => {
    expect(webhallenStockStatus(item(0, future, { "2": 48 }))).toBe("PREORDER");
  });
  it("räknar bara numeriska butiksnycklar — displayCap/webStock/isSentFromStore är inga saldon", () => {
    expect(webhallenStoreStock({ web: 0, displayCap: 50, isSentFromStore: 0, isTrue: true, webStock: { "992": 3 } })).toBe(0);
    expect(webhallenStoreStock({ web: 0, "2": 48, "5": 51, "27": 0 })).toBe(99);
    expect(webhallenStoreStock(null)).toBe(0);
  });
});
