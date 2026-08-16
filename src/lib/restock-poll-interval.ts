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

/**
 * ⛔ TALEN ÄR KALIBRERADE MOT DEN GAMLA TAKTEN, INTE VALDA PÅ KÄNSLA (2026-08-16).
 *
 * Kravet är INTE "ingen butik får mer last än förut" — en butik vars hela feed är en
 * enda sidhämtning lyfts med flit från 60 s till golvet 25 s, dvs 2,4 gånger fler
 * förfrågningar. Det är hela poängen med att mäta, och det är ofarligt: i absoluta
 * tal är det fortfarande EN förfrågan var 25:e sekund.
 *
 * ⛔ KRAVET ÄR I STÄLLET: **ingen butik får en högre ihållande förfrågningstakt än den
 * TYNGSTA feeden i sin klass redan fick av den gamla fasta cadencen.** Den takten
 * tålde butikerna bevisligen i drift, så den är facit — och den är ett tak, inte ett
 * mål. MÄTT 2026-08-16 över alla 42 butiker:
 *   · CDN, gamla takten 60 s: tyngst var Rogerz med 44 förfrågningar ⇒ 0,73 förfr./s.
 *     Taket här är 1/2,0 = **0,50** — under det. Speltrollet 60→34 s, Webhallen 60→48 s,
 *     Kortarkivet 60→30 s, de lätta 60→25 s; Rogerz 60→88 s och Aquitaz 60→74 s, dvs
 *     de två tyngsta blir POLITARE.
 *   · Egen server, gamla takten 120 s: tyngst var Swepoke med 37 ⇒ 0,31 förfr./s.
 *     Taket här är 1/3,5 = **0,29** — under det. CardGame 120→91 s, de lätta 120→60 s;
 *     Swepoke 120→130 s och Shinycards 120→119 s, dvs oförändrat till marginellt
 *     politare.
 * ⛔ Sänk inte `perRequestSeconds` "för att bli snabbare" — då bryts taket, och den
 *    butik som blockerar oss skadar HELA produkten, inte bara Discord. Vill man ha
 *    snabbare svar på en enskild lätt butik är GOLVET rätt spak.
 *
 * Utfall mot de uppmätta förfrågningstalen (drift 2026-08-16, alla 42 butiker):
 *   · CDN: allt upp till 40 förfrågningar blir snabbare eller lika (Webhallen 60→36 s,
 *     Aquitaz 60→56 s, Speltrollet 60→26 s, de lätta 60→25 s). Bara Rogerz (44) går
 *     60→66 s, dvs marginellt POLITARE.
 *   · Egen server: allt upp till 34 blir snabbare eller lika (CardGame 120→91 s,
 *     resten 120→60 s). Bara Swepoke (37) går 120→130 s.
 * ⛔ Sänk inte `perRequestSeconds` vidare "för att bli snabbare" — då bryts kravet
 *    ovan, och den butik som blockerar oss skadar HELA produkten, inte bara Discord.
 *    Vill man ha snabbare svar på en enskild het butik är GOLVET rätt spak.
 */
export function pollBudget(cdn: boolean): PollBudget {
  return cdn
    ? {
        perRequestSeconds: Number(process.env.DISCORD_RESTOCK_CDN_SEC_PER_REQ ?? 2),
        floorSeconds: Number(process.env.DISCORD_RESTOCK_CDN_FLOOR_SEC ?? 25),
        ceilSeconds: Number(process.env.DISCORD_RESTOCK_CEIL_SEC ?? 240),
        unmeasuredSeconds: Number(process.env.DISCORD_RESTOCK_UNMEASURED_SEC ?? 60),
      }
    : {
        perRequestSeconds: Number(process.env.DISCORD_RESTOCK_OWN_SEC_PER_REQ ?? 3.5),
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
