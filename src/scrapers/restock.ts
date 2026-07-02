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

/**
 * Ny produkt i lager: en HELT ny offer (ingen tidigare status = start null) som är
 * I LAGER. netStockEvent emittar inte detta (ingen övergång att räkna), men det är
 * en "ny produkt i lager" värd ett larm — precis som feed-först ger för URL:er
 * utanför katalogen. Övriga vakter (butiken skrapad förut = ej tyst seed, sealed,
 * riktig butik) kontrolleras vid anropet i runScrapeJob.
 */
export function isNewInStockArrival(
  start: StockStatus | null,
  finalStatus: StockStatus
): boolean {
  return start === null && finalStatus === StockStatus.IN_STOCK;
}

export interface NetStockEvent {
  emit: boolean; // skapa en RestockEvent?
  oldStatus: StockStatus;
  isRestock: boolean; // skicka restock-alert?
}

/**
 * Nettoförändring för EN offer under EN körning. Flera annonser kan kollapsa till
 * samma offer (samma produkt+butik+skick+språk) — t.ex. "Astral Radiance Sleeved
 * Booster Pack" + "Astral Radiance Booster Pack". Då räknas bara övergången mellan
 * körningens STARTstatus (start = null om offern är ny) och den billigaste vinnande
 * annonsens status. Mellanliggande upserts inom samma körning ignoreras — det var
 * de som spammade falska restocks (IN→OUT→IN) varje körning.
 */
export function netStockEvent(
  start: StockStatus | null,
  finalStatus: StockStatus
): NetStockEvent {
  const oldStatus = start ?? StockStatus.UNKNOWN;
  const emit = isRealStockTransition(start !== null, oldStatus, finalStatus);
  return { emit, oldStatus, isRestock: emit && isRestock(oldStatus, finalStatus) };
}
