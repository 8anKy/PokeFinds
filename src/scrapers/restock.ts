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

/**
 * Lägen som INTE är "köpbar och skickas nu" — en övergång därifrån till IN_STOCK är
 * det bevakaren väntar på.
 *
 * PREORDER ingår sedan 2026-07-25. Tidigare krävdes OUT_OF_STOCK, så när en
 * förhandsbokning gick till riktigt lager vid release skrevs en RestockEvent (båda
 * statusarna kända och olika → emit) men INGET larm gick ut: händelsen syntes i
 * restock-historiken utan att någon fick mejl — exakt det symtom ägaren felsökte
 * 2026-07-25. Släppet är dessutom det mest värdefulla larmet av alla.
 *
 * UNKNOWN ingår ALDRIG: frånvaro ur en feed sätter UNKNOWN (se offersToMarkSoldOut),
 * och UNKNOWN → IN_STOCK är "vi vet inget → vi ser den", inte en påfyllning. Det var
 * den övergången som spammade från roterande feeds.
 */
const NOT_BUYABLE_NOW: StockStatus[] = [StockStatus.OUT_OF_STOCK, StockStatus.PREORDER];

/** En faktisk restock (skicka alert): slutsåld ELLER förhandsbokning → i lager. */
export function isRestock(oldStatus: StockStatus, newStatus: StockStatus): boolean {
  return newStatus === StockStatus.IN_STOCK && NOT_BUYABLE_NOW.includes(oldStatus);
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

/**
 * Förhandsbokningen ÖPPNAR: slutsåld → går att förhandsboka. Bevakaren vill veta —
 * populära släpp tar slut på förhandsbokningarna innan release.
 *
 * Bara FRÅN OUT_OF_STOCK: IN_STOCK → PREORDER är en försämring (du kunde redan köpa
 * den), och UNKNOWN → PREORDER är en produkt som dykt upp i feeden igen, inte en
 * nyhet — samma anti-spam-regel som för restocks.
 */
export function isPreorderOpen(oldStatus: StockStatus, newStatus: StockStatus): boolean {
  return newStatus === StockStatus.PREORDER && oldStatus === StockStatus.OUT_OF_STOCK;
}

export interface NetStockEvent {
  emit: boolean; // skapa en RestockEvent?
  oldStatus: StockStatus;
  isRestock: boolean; // skicka restock-alert?
  isPreorderOpen: boolean; // skicka "öppen för förhandsbokning"-alert?
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
  return {
    emit,
    oldStatus,
    isRestock: emit && isRestock(oldStatus, finalStatus),
    isPreorderOpen: emit && isPreorderOpen(oldStatus, finalStatus),
  };
}
