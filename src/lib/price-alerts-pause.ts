/**
 * ⛔ PRISLARMEN (PRICE_TARGET) ÄR PAUSADE (ägarbeslut 2026-08-26).
 *
 * VARFÖR — tre defekter, alla mätta i prod samma dag, ingen av dem lagad:
 *
 *  1. LARMET KAN VARA OSANT. `checkPriceAlerts` jämför målpriset mot VILKEN offer som
 *     helst som just blev billigare, utan att kolla lagerstatus, direktlänk eller
 *     källtyp. Mätt: larmet 2026-08-26 03:29 om "Prismatic Evolutions Super-Premium
 *     Collection – nu 1 338,00 kr" utlöstes av en OUT_OF_STOCK-offer hos Beam Cardshop
 *     vars URL (…/products/pokemon-scarlet-violet-prismatic-evolutions) ser felmatchad
 *     ut. Produktens verkliga lägsta pris var 2 665,55 kr och målpriset 2 000 kr — det
 *     fanns alltså inget att köpa till något pris i närheten av det larmet påstod.
 *     Jämför invarianten i CLAUDE.md: butiksfilter kräver IN_STOCK + direkt länk.
 *
 *  2. INGEN COOLDOWN. Så länge priset ligger under målet larmar VARJE nytt litet fall,
 *     varje natt, för evigt. Mätt över 30 dygn: samma produkt+användare 7 gånger
 *     (Prismatic, 08-11→08-26) och 4 gånger (Pitch Black, 08-14→08-26). Restock-larmen
 *     har en cooldown och en flappdämpning; prislarmen har ingenting.
 *
 *  3. MEJLET VISAR ETT ANNAT PRIS ÄN LARMET. `buildAlertEmail` bygger om priset ur
 *     billigaste offer med direktlänk VID UTSKICKET, inte ur priset som utlöste larmet.
 *     Mätt: alert-raden sa "Nuvarande pris: 459 kr" (Beam Cardshop) medan mejlets rubrik
 *     sa "nu 354,56 kr" (Cardmarkets pris i samma stund). Två tal, ett mejl.
 *
 * GRINDEN LIGGER VID SKAPANDET, INTE VID UTSKICKET — exakt samma skäl som för
 * restock-pausen: `dispatchPendingAlerts` läser inte `Alert.channel` utan skickar varje
 * PENDING-rad till användarens påslagna kanaler. En grind vid utskicket hade lämnat
 * raderna liggande och tömt hela högen i ett svep den dag larmen slås på igen.
 *
 * ⛔ BERÖRS INTE: veckobrevets "prisfall på det du bevakar" (en sammanfattning, inte ett
 * larm), `PriceSnapshot`/prishistoriken, "Största prisfall" på /marknad, och
 * restock-larmen (egen flagga, `restockAlertsPaused()`).
 *
 * OMFATTNING NÄR PAUSEN SATTES: exakt 3 bevakningar i hela databasen hade ett målpris,
 * alla tre ägarens egna. Ingen betalande kund fick ett prislarm den dagen pausen
 * infördes — men copyn sålde dem ändå, se nedan.
 *
 * SLÅ PÅ IGEN — TRE STÄLLEN, samma som för restock:
 *   1. `PRICE_ALERTS_PAUSED=0` i env-blocket för `scrape-all.yml` (och
 *      `restock-watch.yml` om det jobbet också startas)
 *   2. `PRICE_ALERTS_PAUSED=0` i RAILWAY — den styr COPYN via speglingen i
 *      `next.config.mjs` och bakas in vid BYGGET (env-ändring ⇒ ny deploy, inte omstart)
 *   3. LAGA DE TRE DEFEKTERNA OVAN FÖRST. Att bara flippa flaggan återuppväcker ett
 *      larm som kan påstå ett pris som inte finns.
 * Läses vid varje ANROP, aldrig vid modulladdning, så tester och engångsskript kan sätta
 * den utan importordningsberoende.
 *
 * ⛔ COPYN ÄR EN DEL AV GRINDEN, INTE EN FÖLJD AV DEN. Pausen av restock-larmen
 * 2026-08-23 rörde inte ett ord av texten, och `/priser` — som i appen ÄR hela paywallen
 * — fortsatte sälja avstängda larm tills två kunder hade betalat 49 kr/mån för dem. Här
 * flyttas prispunkterna därför till egna listor (`premiumPriceFeatures` /
 * `freeExcludedPrice`) som `pausableFeatures()` konkatenerar tillbaka när flaggan är av.
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
