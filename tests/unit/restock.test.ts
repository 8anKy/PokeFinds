/**
 * Tester för restock-övergångslogiken (src/scrapers/restock.ts).
 * Säkrar att första observationen (UNKNOWN) aldrig flaggas som restock.
 */
import { describe, expect, it } from "vitest";
import { StockStatus } from "@prisma/client";
import { isRealStockTransition, isRestock, netStockEvent } from "@/scrapers/restock";

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

describe("netStockEvent (netto per körning, dödar spök-flapparna)", () => {
  it("start OUT, slutstatus OUT (en kolliderande IN-annons mitt i) → ingen händelse", () => {
    // Detta var buggen: två annonser på samma offer gav IN→OUT→IN varje körning.
    // netStockEvent ser bara start (OUT) → billigaste vinnaren (OUT) → inget.
    expect(netStockEvent(OUT_OF_STOCK, OUT_OF_STOCK).emit).toBe(false);
  });

  it("start OUT, slutstatus IN → äkta restock med alert", () => {
    const ev = netStockEvent(OUT_OF_STOCK, IN_STOCK);
    expect(ev).toMatchObject({ emit: true, oldStatus: OUT_OF_STOCK, isRestock: true });
  });

  it("start IN, slutstatus OUT → händelse men ingen restock-alert", () => {
    const ev = netStockEvent(IN_STOCK, OUT_OF_STOCK);
    expect(ev).toMatchObject({ emit: true, isRestock: false });
  });

  it("ny offer (start null) → ingen händelse, oavsett status", () => {
    expect(netStockEvent(null, IN_STOCK).emit).toBe(false);
    expect(netStockEvent(null, OUT_OF_STOCK).emit).toBe(false);
  });
});
