/**
 * Tester för restock-övergångslogiken (src/scrapers/restock.ts).
 * Säkrar att första observationen (UNKNOWN) aldrig flaggas som restock.
 */
import { describe, expect, it } from "vitest";
import { StockStatus } from "@prisma/client";
import { isRealStockTransition, isRestock } from "@/scrapers/restock";

const { IN_STOCK, OUT_OF_STOCK, UNKNOWN } = StockStatus;

describe("isRealStockTransition", () => {
  it("första observationen (ingen tidigare offer) är inte en övergång", () => {
    expect(isRealStockTransition(false, UNKNOWN, IN_STOCK)).toBe(false);
  });

  it("UNKNOWN → IN_STOCK räknas inte (ej äkta övergång)", () => {
    expect(isRealStockTransition(true, UNKNOWN, IN_STOCK)).toBe(false);
  });

  it("IN_STOCK → OUT_OF_STOCK är en äkta övergång", () => {
    expect(isRealStockTransition(true, IN_STOCK, OUT_OF_STOCK)).toBe(true);
  });

  it("OUT_OF_STOCK → IN_STOCK är en äkta övergång", () => {
    expect(isRealStockTransition(true, OUT_OF_STOCK, IN_STOCK)).toBe(true);
  });

  it("oförändrad status är ingen övergång", () => {
    expect(isRealStockTransition(true, IN_STOCK, IN_STOCK)).toBe(false);
  });
});

describe("isRestock", () => {
  it("OUT_OF_STOCK → IN_STOCK = restock", () => {
    expect(isRestock(OUT_OF_STOCK, IN_STOCK)).toBe(true);
  });

  it("UNKNOWN → IN_STOCK är INTE en restock (källan till falsklarmen)", () => {
    expect(isRestock(UNKNOWN, IN_STOCK)).toBe(false);
  });

  it("IN_STOCK → OUT_OF_STOCK är inte en restock", () => {
    expect(isRestock(IN_STOCK, OUT_OF_STOCK)).toBe(false);
  });
});
