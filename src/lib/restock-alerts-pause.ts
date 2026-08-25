/**
 * ⛔ RESTOCK-LARMEN ÄR PAUSADE (ägarbeslut 2026-08-23, tätat 2026-08-25).
 *
 * Att stänga av `restock-watch.yml` räckte INTE: larmen skapas på TVÅ vägar och
 * bara den ena låg i det jobbet.
 *   1. `runRestockScan` — snabbfilen var 10:e minut. Pausad med workflow disable.
 *   2. `runScrapeJob`, dvs nattens `scrape-all` — den FULLA insamlingen diffar
 *      lagerstatus per butik och anropar samma `checkRestockAlerts`.
 * Väg 2 fortsatte alltså mejla och pusha en gång per natt medan pause-mejlet
 * 2026-08-23 sa till användarna att larmen låg nere. MÄTT i prod 2026-08-25:
 * 12 larm skapade kl 02–03 UTC (exakt scrape-alls fönster 02:52–03:34), 8 mejl
 * till ett och samma konto. Före pausen låg larmen utspridda över dygnet.
 *
 * GRINDEN LIGGER VID SKAPANDET, INTE VID UTSKICKET. `dispatchPendingAlerts` läser
 * INTE `Alert.channel` — den skickar varje PENDING-rad till användarens påslagna
 * kanaler. En grind vid utskicket hade lämnat raderna PENDING och tömt hela högen
 * i ett svep den dag larmen slås på igen.
 *
 * ⛔ Berörs INTE: `RestockEvent` + `Offer.stockStatus` (restock-historiken på
 * produktsidorna ska fortsätta fyllas av nattkedjan), veckobrevets "X av dina
 * bevakade är i lager igen" (en sammanfattning, inte ett larm) och Discord-lanen.
 * ⛔ Prislarm (PRICE_TARGET) är en EGEN funktion och är INTE pausad — användarna
 * har aldrig fått veta något annat.
 *
 * SLÅ PÅ IGEN: `RESTOCK_ALERTS_PAUSED=0` i miljön för `scrape-all.yml` OCH
 * `gh workflow enable restock-watch.yml` (höj den externa pingern FÖRST — se
 * kostnadsavsnittet i CLAUDE.md). Läses vid varje ANROP, aldrig vid modulladdning,
 * så tester och engångsskript kan sätta den utan importordningsberoende.
 */
export function restockAlertsPaused(): boolean {
  return process.env.RESTOCK_ALERTS_PAUSED !== "0";
}
