import { describe, expect, it } from "vitest";
import {
  CARDMARKET_RETAILER_NAME,
  pickCardValue,
  productMarketValue,
  type ValuedOffer,
} from "@/lib/market-value";

const offer = (
  name: string,
  price: number | null,
  stockStatus = "IN_STOCK",
  url = "https://example.se/produkt/abc"
): ValuedOffer => ({ price, stockStatus, url, retailer: { name } });

describe("productMarketValue — Cardmarket först", () => {
  it("väljer Cardmarket även när en marknadsplats är billigare", () => {
    // Brock's Rhydon · Gym Heroes, mätt i prod 2026-09-22: CM 327,12 kr, Tradera 67 kr.
    const v = productMarketValue([
      offer("Tradera", 6700),
      offer(CARDMARKET_RETAILER_NAME, 32712),
      offer("CardTrader", 9900),
    ]);
    expect(v).toEqual({ price: 32712, fromCardmarket: true });
  });

  it("väljer Cardmarket även när en BUTIK är billigare (sealed)", () => {
    // 30th Celebration ETB: CM 1 500,24 kr, Goblinen 799 kr.
    const v = productMarketValue([
      offer("Goblinen", 79900),
      offer(CARDMARKET_RETAILER_NAME, 150024),
    ]);
    expect(v).toEqual({ price: 150024, fromCardmarket: true });
  });

  it("tar CM även när CM-offern är märkt OUT_OF_STOCK (uppskattat pris)", () => {
    const v = productMarketValue([
      offer("Tradera", 5000),
      offer(CARDMARKET_RETAILER_NAME, 12000, "OUT_OF_STOCK"),
    ]);
    expect(v).toEqual({ price: 12000, fromCardmarket: true });
  });

  it("lägsta CM-offern vinner när produkten bär flera", () => {
    const v = productMarketValue([
      offer(CARDMARKET_RETAILER_NAME, 9000),
      offer(CARDMARKET_RETAILER_NAME, 7500),
    ]);
    expect(v.price).toBe(7500);
  });

  it("faller tillbaka på lägsta direkta offer när CM saknas", () => {
    const v = productMarketValue([offer("Goblinen", 79900), offer("SF-Bok", 59900)]);
    expect(v).toEqual({ price: 59900, fromCardmarket: false });
  });

  it("reserven prioriterar I LAGER före slutsålt", () => {
    const v = productMarketValue([
      offer("SF-Bok", 40000, "OUT_OF_STOCK"),
      offer("Goblinen", 59900, "IN_STOCK"),
    ]);
    expect(v).toEqual({ price: 59900, fromCardmarket: false });
  });

  it("0 kr och null är inget pris", () => {
    expect(productMarketValue([offer(CARDMARKET_RETAILER_NAME, 0), offer("Tradera", null)]).price).toBeNull();
  });

  it("sök-/bläddringslänkar räknas inte", () => {
    const v = productMarketValue([
      offer(CARDMARKET_RETAILER_NAME, 10000, "IN_STOCK", "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=x"),
    ]);
    expect(v.price).toBeNull();
  });
});

describe("pickCardValue — CM-produkter jämförs bara med varandra", () => {
  it("ett syskons marknadsplatspris vinner ALDRIG över kortets CM-pris", () => {
    const v = pickCardValue([
      { price: 32712, fromCardmarket: true },
      { price: 6700, fromCardmarket: false },
    ]);
    expect(v).toEqual({ price: 32712, fromCardmarket: true });
  });

  it("lägsta CM-priset vinner när flera produkter har CM", () => {
    expect(
      pickCardValue([
        { price: 32712, fromCardmarket: true },
        { price: 29900, fromCardmarket: true },
      ]).price
    ).toBe(29900);
  });

  it("utan CM någonstans vinner lägsta reserven", () => {
    expect(
      pickCardValue([
        { price: 9900, fromCardmarket: false },
        { price: 6700, fromCardmarket: false },
      ])
    ).toEqual({ price: 6700, fromCardmarket: false });
  });

  it("tomt in ⇒ inget värde", () => {
    expect(pickCardValue([]).price).toBeNull();
    expect(pickCardValue([{ price: null, fromCardmarket: false }]).price).toBeNull();
  });
});
