/**
 * HUR OFTA FÅR VI HÄMTA EN BUTIKS FEED? — artighetstaket, som ren funktion.
 *
 * ⛔ TAKTEN VÄLJS INTE, DEN FALLER UT UR ETT TAK PÅ FÖRFRÅGNINGAR (2026-08-16).
 * Discord-lanen delade tidigare in butikerna efter PLATTFORM — "Shopify varje minut,
 * egna servrar varannan" — som om alla feedar kostade lika mycket att hämta. De gör
 * inte det. En butik vars hela feed är två sidhämtningar och en vars feed är trettio
 * kollektionsanrop fick då femton gångers skillnad i last mot sin server utan att
 * någon hade valt det, och den billiga butiken pollades onödigt sällan medan den dyra
 * pollades onödigt ofta. Vi mäter i stället vad hämtningen FAKTISKT kostade
 * (`requestCountForHost` i scrapers/http.ts) och räknar fram intervallet så att
 * butiken aldrig får mer än en förfrågan per `perRequestSeconds` i snitt.
 *
 * ⛔ TVÅ NIVÅER, OCH SKILLNADEN ÄR VEM SOM BETALAR. Shopify-butikernas JSON serveras
 * av Shopifys CDN, byggt för att möta hela deras kundtrafik — våra förfrågningar
 * landar aldrig på butikens egen maskin. Quickbutik/Woo/PrestaShop/Starweb/custom kör
 * sin egen server, där varje förfrågan konkurrerar med riktiga kunder. Därav dubbelt
 * så generöst tak för CDN. Att bli blockerad av en butik skadar hela produkten, inte
 * bara Discord.
 *
 * ⛔ GOLVET ÄR INTE "SÅ SNABBT SOM MÖJLIGT". Det finns för att en feed på två
 * förfrågningar annars hade pollats var sjätte sekund — det har ingen butik bett om,
 * och det köper ingenting: en påfyllning som upptäcks inom en halv minut är redan
 * snabbare än varje mejlbaserad väg.
 */
export interface PollBudget {
  /** Sekunder per förfrågan butiken får kosta i snitt. */
  perRequestSeconds: number;
  /** Snabbast tillåtna takt, oavsett hur billig feeden är. */
  floorSeconds: number;
  /** Långsammast tillåtna takt, oavsett hur dyr feeden är. */
  ceilSeconds: number;
  /** Takt innan kostnaden är uppmätt (första varvet). */
  unmeasuredSeconds: number;
}

export function pollBudget(cdn: boolean): PollBudget {
  return cdn
    ? {
        perRequestSeconds: Number(process.env.DISCORD_RESTOCK_CDN_SEC_PER_REQ ?? 2.5),
        floorSeconds: Number(process.env.DISCORD_RESTOCK_CDN_FLOOR_SEC ?? 25),
        ceilSeconds: Number(process.env.DISCORD_RESTOCK_CEIL_SEC ?? 240),
        unmeasuredSeconds: Number(process.env.DISCORD_RESTOCK_UNMEASURED_SEC ?? 60),
      }
    : {
        perRequestSeconds: Number(process.env.DISCORD_RESTOCK_OWN_SEC_PER_REQ ?? 6),
        floorSeconds: Number(process.env.DISCORD_RESTOCK_OWN_FLOOR_SEC ?? 60),
        ceilSeconds: Number(process.env.DISCORD_RESTOCK_CEIL_SEC ?? 240),
        unmeasuredSeconds: Number(process.env.DISCORD_RESTOCK_UNMEASURED_SEC ?? 60),
      };
}

/**
 * `requests` = hur många HTTP-förfrågningar den senaste hämtningen kostade.
 * 0 (eller mindre) = ännu inte uppmätt → gamla takten tills vi vet.
 */
export function pollIntervalMs(requests: number, budget: PollBudget): number {
  if (!(requests > 0)) return Math.round(budget.unmeasuredSeconds * 1000);
  const seconds = Math.min(
    budget.ceilSeconds,
    Math.max(budget.floorSeconds, requests * budget.perRequestSeconds)
  );
  return Math.round(seconds * 1000);
}
