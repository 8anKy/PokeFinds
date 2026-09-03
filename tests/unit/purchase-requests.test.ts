import { describe, expect, it } from "vitest";
import { allowsPurchaseRequests, purchaseAskText } from "@/lib/purchase-requests";

describe("allowsPurchaseRequests", () => {
  it("saknad nyckel/ingen preferences = PÅ", () => {
    expect(allowsPurchaseRequests(null)).toBe(true);
    expect(allowsPurchaseRequests(undefined)).toBe(true);
    expect(allowsPurchaseRequests({})).toBe(true);
    expect(allowsPurchaseRequests({ favoriteSets: ["sv1"] })).toBe(true);
    expect(allowsPurchaseRequests("trasigt")).toBe(true);
  });
  it("bara ett uttryckligt false stänger av", () => {
    expect(allowsPurchaseRequests({ allowPurchaseRequests: false })).toBe(false);
    expect(allowsPurchaseRequests({ allowPurchaseRequests: true })).toBe(true);
    expect(allowsPurchaseRequests({ allowPurchaseRequests: "nej" })).toBe(true);
  });
});

describe("purchaseAskText", () => {
  it("nämner kortet och setet", () => {
    expect(purchaseAskText("Charizard ex", "Obsidian Flames")).toBe(
      "Hej! Är ditt Charizard ex (Obsidian Flames) till salu?"
    );
  });
  it("sealed utan set: bara namnet", () => {
    expect(purchaseAskText("151 Elite Trainer Box", null)).toBe(
      "Hej! Är ditt 151 Elite Trainer Box till salu?"
    );
  });
});
