import { describe, expect, it } from "vitest";
import { headlineCandidates, lowestOfferSource } from "@/lib/offer-source";
import { computeLowestPrice } from "@/services/products";

/**
 * Rubrikpriset följer Cardmarket (ägarbeslut 2026-10-15): en Tradera-annons slår aldrig
 * ett Cardmarket-pris. Tradera finns kvar i listan — bara rubriken byter källa.
 */
const cm = { price: 30000, stockStatus: "IN_STOCK" as const, url: "https://www.cardmarket.com/en/Pokemon/Products?idProduct=1&language=1", retailer: { name: "Cardmarket" } };
const tradera = { price: 15000, stockStatus: "IN_STOCK" as const, url: "https://www.tradera.com/item/1001337/123/x", retailer: { name: "Tradera" } };
const store = { price: 25000, stockStatus: "IN_STOCK" as const, url: "https://butik.se/p/x", retailer: { name: "Butik" } };

describe("headlineCandidates", () => {
  it("Tradera ställer inte upp när Cardmarket har ett pris", () => {
    expect(headlineCandidates([cm, tradera])).toEqual([cm]);
    expect(computeLowestPrice([cm, tradera]).price).toBe(30000);
    expect(lowestOfferSource([cm, tradera], 30000)).toEqual({ name: "Cardmarket", live: true });
  });
  it("även en uppskattad CM-offer räcker för att Tradera inte ska ta rubriken", () => {
    const est = { ...cm, stockStatus: "OUT_OF_STOCK" as const };
    expect(headlineCandidates([est, tradera])).toEqual([est]);
  });
  it("butiker konkurrerar som förut", () => {
    expect(computeLowestPrice([cm, tradera, store]).price).toBe(25000);
  });
  it("utan CM-pris gäller allt som förut", () => {
    expect(headlineCandidates([tradera, store])).toEqual([tradera, store]);
    expect(headlineCandidates([{ ...cm, price: null }, tradera])).toHaveLength(2);
  });
});
