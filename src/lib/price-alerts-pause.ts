/**
 * PRISLARMEN (PRICE_TARGET / PRICE_DROP) — PAUSFLAGGAN.
 *
 * Pausade 2026-08-26 (ägarbeslut) för SEX defekter; ALLA LAGADE 2026-09-06. Flaggan
 * finns kvar som på/av-spak — samma mönster som restock-larmen, men en EGEN variabel:
 * restock pausades för KOSTNAD, prislarmen för en LAGNING, och de slås på var för sig.
 *
 * VAD SOM VAR TRASIGT OCH HUR DET ÄR LAGAT (mätdata i git-historiken för den här filen):
 *
 *  1. LARMET KUNDE VARA OSANT — dömdes på vilken offer som helst som råkade bli
 *     billigare, utan lager-/direktlänks-/källkoll (mätt: "nu 1 338 kr" ur en slutsåld
 *     offer på en produkt vars lägsta pris var 2 665 kr).
 *     → Domen tas på produktens LÄGSTA KÖPBARA pris: i lager + direktlänk + > 0 kr
 *       (`lowestBuyableOffer`, samma urval som produktsidans rubrikpris).
 *  2. INGEN COOLDOWN — samma produkt+användare 7 ggr på 30 dygn.
 *     → SPÄRR (latch) på bevakningen: `WatchlistItem.priceAlertFiredOre`. Målpris: ETT
 *       larm per gång målet nås, släpps när priset åter ligger över målet. Prisfall:
 *       nästa larm kräver ett nytt tydligt fall under larmnivån; släpps när priset
 *       stigit PRICE_ALERT_REARM_PERCENT (10 %) över den. `rearmPriceAlerts()` körs
 *       efter varje prisjobb. Dom: `src/lib/price-alert-rule.ts`.
 *  3. MEJLET VISADE ETT ANNAT PRIS ÄN LARMET (459 kr i raden, 354,56 kr i rubriken,
 *     ett tredje i pushen).
 *     → `Alert.priceOre` + `Alert.retailerId` skrivs när larmet skapas; larmrad, mejl
 *       och push läser samma tal och länkar till samma butik.
 *  4. "LÄMNA TOMT FÖR ATT BARA BEVAKA PRISFALL" FUNGERADE ALDRIG (18 bevakningar hos
 *     4 användare stod tysta).
 *     → Prisfall-läget finns: utan målpris larmar bevakningen vid ett fall på minst
 *       PRICE_ALERT_MIN_PERCENT (5 %) OCH PRICE_ALERT_MIN_ORE (10 kr) från det pris
 *       användaren senast såg; fall över PRICE_ALERT_MAX_PERCENT (60 %) avvisas som
 *       troligare fel data än ett pris. Copyn säger nu vad tröskeln är.
 *  5. PRICE_DROP SKAPADES ALDRIG — bara butiksfeedarnas offer-diff nådde koden, så ett
 *     äkta CM-prisfall på en singel larmade inte.
 *     → Alla tre prisjobben (nattkedjan, cardmarket-refresh 13:00, hot-card 21:00) tar
 *       en ögonblicksbild av bevakade produkters lägsta köpbara pris FÖRE och sveper
 *       EFTER (`services/price-alert-sweep.ts`); Discord-lanens "Nytt lägre pris"
 *       blir dessutom en PRICE_DROP-hit till `/api/cron/restock-hit` inom ~20 s.
 *  6. MEJLET KUNDE SKRIVA "0 KR" (`?? 0`).
 *     → Priset är > 0 per urval; ett äldre larm utan sparat pris får ett mejl utan
 *       prisrad. Offer-urvalet i mejlet kräver `price > 0`.
 *
 * GRINDEN LIGGER VID SKAPANDET, INTE VID UTSKICKET — samma skäl som för restock-pausen:
 * `dispatchPendingAlerts` läser inte `Alert.channel` utan skickar varje PENDING-rad till
 * användarens påslagna kanaler. En grind vid utskicket hade lämnat raderna liggande och
 * tömt hela högen i ett svep den dag larmen slås på igen.
 *
 * ⛔ BERÖRS INTE: veckobrevets "prisfall på det du bevakar" (en sammanfattning, inte ett
 * larm), `PriceSnapshot`/prishistoriken, "Största prisfall" på /marknad, och
 * restock-larmen (egen flagga, `restockAlertsPaused()`).
 *
 * SLÅ PÅ/AV — FYRA STÄLLEN SOM MÅSTE STÅ LIKA:
 *   1. `PRICE_ALERTS_PAUSED` i env-blocket för `scrape-all.yml` (nattkedjans svep)
 *   2. … i `cardmarket-refresh.yml` (13:00-svepet)
 *   3. … i `hot-card-refresh.yml` (21:00-svepet)
 *   4. … i RAILWAY — styr Discord-lanens PRICE_DROP-hits OCH copyn via speglingen i
 *      `next.config.mjs` + Dockerfilens ARG; bakas in vid BYGGET (env-ändring ⇒ ny
 *      deploy, inte omstart).
 * Läses vid varje ANROP, aldrig vid modulladdning, så tester och engångsskript kan sätta
 * den utan importordningsberoende. Torrkörning mot prod (vad som HADE larmat just nu):
 * `node scripts/with-prod-db.mjs npx tsx scripts/price-alert-dry-run.ts`.
 *
 * ⛔ COPYN ÄR EN DEL AV GRINDEN, INTE EN FÖLJD AV DEN. Pausen av restock-larmen
 * 2026-08-23 rörde inte ett ord av texten, och `/priser` — som i appen ÄR hela paywallen
 * — fortsatte sälja avstängda larm tills två kunder hade betalat 49 kr/mån för dem. Här
 * ligger prispunkterna därför i egna listor (`premiumPriceFeatures` / `freeExcludedPrice`)
 * som `pausableFeatures()` konkatenerar tillbaka när flaggan är av.
 * Vaktat av `tests/unit/price-alert-pause.test.ts`.
 */
export function priceAlertsPaused(): boolean {
  return process.env.PRICE_ALERTS_PAUSED !== "0";
}

/**
 * KLIENTSIDANS SVAR PÅ SAMMA FRÅGA.
 *
 * ⛔ INTE en andra sanning: `NEXT_PUBLIC_PRICE_ALERTS_PAUSED` sätts ALDRIG för hand —
 * `next.config.mjs` speglar den ur `PRICE_ALERTS_PAUSED`, så det finns fortfarande exakt
 * EN variabel att ändra. Skälet till att den behövs alls: ytorna som lovar prislarm
 * (bevakningsknappen och målpris-arket på produktsidan, bevakningslistans reglage) sitter
 * i klientkomponenter under ISR-sidor, och serverfunktionen ovan finns inte i
 * webbläsarens bundle.
 *
 * ⛔ SAMMA DEFAULT SOM SERVERN: allt utom "0" betyder PAUSAT. Fail-safe åt rätt håll —
 * glöms speglingen visar gränssnittet "pausat" för en funktion som fungerar (irriterande),
 * aldrig "fungerar" för en funktion som är av (en lögn till en betalande kund).
 */
export function priceAlertsPausedClient(): boolean {
  return process.env.NEXT_PUBLIC_PRICE_ALERTS_PAUSED !== "0";
}
