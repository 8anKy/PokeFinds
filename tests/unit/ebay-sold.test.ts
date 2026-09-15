import { describe, expect, it } from "vitest";
import { mapEbaySoldOffer, parseGradeTenths, priceOreFromCurrency, type EbaySoldOffer } from "@/lib/ebay-sold";
import { GBP_FALLBACK_ORE, priceOreFromGbp } from "@/lib/exchange-rate";

/**
 * eBay-sålda graderade via prisleverantören (2026-09-15). Raden måste bevisa sig:
 * läsbart betyg, positivt pris i känd valuta, giltigt datum — annars null.
 * GBP → öre går genom samma nollvakt som EUR/USD.
 */
const rates = { eurToOre: 1150, usdToOre: 1050, gbpToOre: 1330 };
const offer = (over: Partial<EbaySoldOffer> = {}): EbaySoldOffer => ({
  ebay_item_id: "307070509114",
  title: "2025 POKEMON PRE EN-PRISMATIC EVOLUTIONS #161 UMBREON EX PSA 10",
  price: 5233.25,
  currency: "GBP",
  company: "PSA",
  grade: "10",
  url: "https://www.ebay.co.uk/itm/307070509114",
  ended_at: "2026-07-21T22:00:00+00:00",
  ...over,
});

describe("parseGradeTenths", () => {
  it("hela och halva betyg 1–10, inget annat", () => {
    expect(parseGradeTenths("10")).toBe(100);
    expect(parseGradeTenths("9.5")).toBe(95);
    expect(parseGradeTenths("6,5")).toBe(65);
    expect(parseGradeTenths("9.3")).toBeNull();
    expect(parseGradeTenths("11")).toBeNull();
    expect(parseGradeTenths("")).toBeNull();
    expect(parseGradeTenths("Authentic")).toBeNull();
  });
});

describe("priceOreFromCurrency", () => {
  it("GBP/USD/EUR/SEK via kursen, okänd valuta = null, 0 = null", () => {
    expect(priceOreFromCurrency(100, "GBP", rates)).toBe(133000);
    expect(priceOreFromCurrency(100, "usd", rates)).toBe(105000);
    expect(priceOreFromCurrency(100, "EUR", rates)).toBe(115000);
    expect(priceOreFromCurrency(100, "SEK", rates)).toBe(10000);
    expect(priceOreFromCurrency(100, "JPY", rates)).toBeNull();
    expect(priceOreFromCurrency(0, "GBP", rates)).toBeNull();
    expect(priceOreFromGbp(0.0001, { gbpToOre: GBP_FALLBACK_ORE })).toBeNull();
  });
});

describe("mapEbaySoldOffer", () => {
  it("giltig rad: prefixat id, bolag, betyg×10, öre, datum", () => {
    const r = mapEbaySoldOffer(offer(), rates)!;
    expect(r).toMatchObject({ itemId: "ebay:307070509114", issuer: "PSA", gradeTenths: 100, price: 6960223 });
    expect(r.soldAt.toISOString()).toBe("2026-07-21T22:00:00.000Z");
  });
  it("okänt bolag → OTHER; Beckett → BGS", () => {
    expect(mapEbaySoldOffer(offer({ company: "Beckett" }), rates)?.issuer).toBe("BGS");
    expect(mapEbaySoldOffer(offer({ company: "MNT" }), rates)?.issuer).toBe("OTHER");
  });
  it("oläsbart betyg, nollpris, okänd valuta eller trasigt datum ⇒ null", () => {
    expect(mapEbaySoldOffer(offer({ grade: "Auth" }), rates)).toBeNull();
    expect(mapEbaySoldOffer(offer({ price: 0 }), rates)).toBeNull();
    expect(mapEbaySoldOffer(offer({ currency: "JPY" }), rates)).toBeNull();
    expect(mapEbaySoldOffer(offer({ ended_at: "igår" }), rates)).toBeNull();
  });
});
