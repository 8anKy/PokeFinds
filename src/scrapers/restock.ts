import { StockStatus } from "@prisma/client";

/**
 * En ÄKTA lagerövergång (värd en RestockEvent): vi har sett erbjudandet förut,
 * statusen ändrades faktiskt, och VARKEN gamla eller nya statusen är UNKNOWN.
 * Första observationen (UNKNOWN → något) är INTE en övergång — annars flaggas
 * varje nyupptäckt i-lager-produkt felaktigt som restock.
 */
export function isRealStockTransition(
  hadPrevious: boolean,
  oldStatus: StockStatus,
  newStatus: StockStatus
): boolean {
  return (
    hadPrevious &&
    oldStatus !== newStatus &&
    oldStatus !== StockStatus.UNKNOWN &&
    newStatus !== StockStatus.UNKNOWN
  );
}

/** En faktisk restock (skicka alert): slutsåld → i lager. */
export function isRestock(oldStatus: StockStatus, newStatus: StockStatus): boolean {
  return oldStatus === StockStatus.OUT_OF_STOCK && newStatus === StockStatus.IN_STOCK;
}
