import { describe, it, expect } from "vitest";
import { webhallenStockStatus } from "@/scrapers/adapters/webhallen-adapter";

// Minimal WebhallenProduct-form; bara fälten webhallenStockStatus läser spelar roll.
const item = (stockWeb: number, releaseTs?: number, discontinued?: number) =>
  ({ id: 1, name: "x", price: { price: "1", currency: "SEK" }, stock: { web: stockWeb }, release: releaseTs != null ? { timestamp: releaseTs } : null, discontinued }) as never;

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

/**
 * REGRESSIONSVAKT: Mega Greninja ex Premium Collection (2026-08-14). Produkten var
 * utgången ur sortimentet ("Produkten har utgått", `discontinued: 2`) men bar samtidigt
 * `web: 1` — den sista enheten låg i en fysisk butik. Utgått måste slå lagersiffran,
 * annars rapporteras en vara som inte går att köpa som "i lager".
 */
describe("webhallenStockStatus — utgången produkt", () => {
  it("utgått slår lagersiffran (det verkliga Greninja-fallet: web=1)", () => {
    expect(webhallenStockStatus(item(1, past, 2))).toBe("OUT_OF_STOCK");
  });
  it("utgått slår även ett stort lagersaldo", () => {
    expect(webhallenStockStatus(item(51, undefined, 2))).toBe("OUT_OF_STOCK");
  });
  it("utgått slår förhandsbokning (framtida release på en utgången rad)", () => {
    expect(webhallenStockStatus(item(0, future, 2))).toBe("OUT_OF_STOCK");
  });
  it("discontinued=0 är INTE utgått — vanlig lagerdom gäller", () => {
    expect(webhallenStockStatus(item(51, undefined, 0))).toBe("IN_STOCK");
  });
  it("saknat fält (sök-API:ts rader bär det inte) ändrar ingenting", () => {
    expect(webhallenStockStatus(item(51))).toBe("IN_STOCK");
  });
});
