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
 * SLÅ PÅ IGEN — TRE STÄLLEN, och glöms det tredje ljuger gränssnittet åt andra
 * hållet (larmen går, men appen säger att de är pausade):
 *   1. `RESTOCK_ALERTS_PAUSED=0` i env-blocket för `scrape-all.yml`
 *   2. `gh workflow enable restock-watch.yml` (höj den externa pingern FÖRST —
 *      se kostnadsavsnittet i CLAUDE.md)
 *   3. `RESTOCK_ALERTS_PAUSED=0` i RAILWAY. Det är den som styr COPYN: prissidans
 *      Pro-punkter, inställningarnas reglage, bevakningslistan och set-klockan.
 *      Bakas in vid BYGGET via `next.config.mjs` → en env-ändring i Railway
 *      kräver en ny deploy, inte bara en omstart.
 * Läses vid varje ANROP, aldrig vid modulladdning, så tester och engångsskript
 * kan sätta den utan importordningsberoende.
 *
 * ⛔ COPYN ÄR EN DEL AV GRINDEN, INTE EN FÖLJD AV DEN. Pausen 2026-08-23 stängde
 * av larmen och rörde inte ett ord av texten: `/priser` — som i appen ÄR hela
 * paywallen — fortsatte sälja "alla restock-larm" i tre av åtta Pro-punkter, och
 * två kunder betalade 49 kr/mån för dem (2026-08-22 och 2026-08-24; den senare
 * hann aldrig få pausbeskedet, engångsutskicket hade redan gått). Vaktat av
 * `tests/unit/restock-pause-copy.test.ts`.
 */
export function restockAlertsPaused(): boolean {
  return process.env.RESTOCK_ALERTS_PAUSED !== "0";
}

/**
 * KLIENTSIDANS SVAR PÅ SAMMA FRÅGA.
 *
 * ⛔ INTE en andra sanning: `NEXT_PUBLIC_RESTOCK_ALERTS_PAUSED` sätts ALDRIG för
 * hand — `next.config.mjs` speglar den ur `RESTOCK_ALERTS_PAUSED`, så det finns
 * fortfarande exakt EN variabel att ändra. Skälet till att den behövs alls: de
 * ytor som lovar larm (bevakningsknappen på produktsidan, set-klockan,
 * bevakningslistans reglage) sitter i klientkomponenter under en ISR-sida, och
 * den serverfunktionen ovan finns inte i webbläsarens bundle.
 *
 * ⛔ SAMMA DEFAULT SOM SERVERN: allt utom "0" betyder PAUSAT. Fail-safe åt rätt
 * håll — glöms speglingen visar gränssnittet "pausat" för en funktion som
 * fungerar (irriterande), aldrig "fungerar" för en funktion som är av (en lögn
 * till en betalande kund, vilket var hela orsaken till den här grinden).
 */
export function restockAlertsPausedClient(): boolean {
  return process.env.NEXT_PUBLIC_RESTOCK_ALERTS_PAUSED !== "0";
}
