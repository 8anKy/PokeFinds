import { unstable_cache } from "next/cache";

/**
 * TTL-cache för publika läsfrågor. Datan uppdateras ~en gång/dygn av de schemalagda
 * jobben, så inaktualitet i timmar är OK — varje cache-träff är en Neon-fråga som
 * UTEBLIR (sänker både egress och compute).
 *
 * TTL:en STYR ÄVEN SIDORNAS ISR (kvot-kritiskt, mätt 2026-07-25). Next.js sätter en
 * routes revalidate till det LÄGSTA värdet bland segmentets `export const revalidate`
 * OCH alla cachade läsningar inuti renderingen. Med 600 s här blev alltså varje
 * ISR-sida 10 minuter färsk trots `export const revalidate = 3600` — bevisat i
 * produktion: produktsidorna svarade `Cache-Control: s-maxage=600` och en sida som
 * värmdes gick STALE efter 55 min. Följden: varje återbesök på en populär sida
 * renderades om (≈50 Neon-frågor) sex gånger oftare än avsett, vilket höll computen
 * vaken dygnet runt. 3600 = samma färskhet som sidorna redan DOKUMENTERAR att de har
 * ("≤1h gammalt", live-product-pricing.tsx) — höj inte utan att först ge produktsidan
 * en klient-uppdatering av priset, för den HTML:en ÄR priset användaren ser.
 *
 * VIKTIGT: `unstable_cache` serialiserar returvärdet → Date-fält blir STRÄNGAR vid
 * cache-träff. Anropare som gör datummatematik på cachad data MÅSTE wrappa i
 * `new Date(x)` (tål både Date och sträng). Annars kraschar sidan (TypeError).
 *
 * TAGGEN (2026-07-27): TTL:en ensam gjorde prisdatan otillförlitligt FÄRSK i andra
 * änden. Prisjobben skriver ~16:00 UTC; en produktsida som cachats 15:30 visar
 * gårdagens sista punkt, och eftersom stale-while-revalidate serverar den GAMLA
 * sidan medan den nya renderas i bakgrunden ser FÖRSTA besökaren efter varje jobb
 * alltid gårdagens graf. Med tunn trafik betyder det i praktiken att de flesta
 * produktsidor visar gårdagens kurva ("varför har bara några kort dagens punkt?").
 * Sidorna kan inte bara få kortare TTL — det var precis det som höll Neon vaken
 * (se ovan). I stället invaliderar jobben taggen när de FAKTISKT skrivit något:
 * `POST /api/revalidate`. Ingen extra rendering för sidor ingen besöker.
 */
export const PRICE_CACHE_TAG = "priser";

/**
 * TAGG FÖR PRIS-OBEROENDE DATA (2026-08-05). `PRICE_CACHE_TAG` är default, och
 * `/api/revalidate` tömmer den 3-4 ggr/dygn när prisjobben skrivit. Det är rätt för
 * priser — men flera av de DYRASTE cacherna innehåller ingen prisinformation alls
 * och kastades ändå bort varje gång:
 *   · startsidans showcase (24h TTL, en groupBy över ~420k PriceSnapshot-rader)
 *   · /produkter-facetterna (set- och butikslistan)
 *   · sitemapen (40 000 produkter + 1 000 set)
 * En sådan cache med 24h TTL levde i praktiken ~6h. Den här taggen invalideras
 * ALDRIG av prisjobben — bara av TTL:en — så arbetet görs en gång per TTL-fönster.
 *
 * ⛔ Sätt den bara på läsningar som INTE visar ett pris. Blir en prisberoende cache
 * märkt "statisk" blir priset gammalt tills TTL:en löper ut, tyst.
 */
export const STATIC_CACHE_TAG = "statisk";

export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key: string,
  revalidateSeconds = 3600,
  tags: string[] = [PRICE_CACHE_TAG]
): (...args: A) => Promise<R> {
  // ÅSKFLOCKEN (mätt i prod 2026-08-31, pg_stat-delta 00:32 UTC): unstable_cache
  // har INGEN dedup av samtidiga missar — vid en TTL-utgång körde ~5 parallella
  // requests VAR SIN råläsning (marknadsstatistikens 24h-count à 15 s kördes 5 ggr,
  // computeChanges' 344k-radersaggregat 13 ggr på 5 min). singleFlight INNANFÖR
  // unstable_cache gör flocken till EN DB-körning; alla väntare delar löftet.
  // ⛔ Wrappern suddar fn.toString()-entropin ur Nexts cachenyckel — `key` är nu
  // hela identiteten. Aldrig samma key-sträng för två olika läsningar.
  return unstable_cache(
    singleFlight(fn, (...args) => `${key}:${JSON.stringify(args)}`),
    [key],
    { revalidate: revalidateSeconds, tags }
  );
}

/**
 * Slår samman SAMTIDIGA identiska anrop till ETT. Ingen cache: löftet delas bara så
 * länge det är obesvarat, och nyckeln städas när det settlar → noll inaktualitet, inget
 * minne som växer.
 *
 * VARFÖR: Next kör en sidas `generateMetadata` och sidkroppen PARALLELLT. Båda läste
 * produkten, båda startade innan den andra hunnit fylla TTL-cachen → varje kall
 * produktsidrendering körde uppslaget TVÅ gånger mot Neon (mätt 2026-07-25: 316 anrop
 * mot 160 renderingar). `react`s `cache()` vore det idiomatiska greppet men exporteras
 * bara under react-server-villkoret — importeras modulen från ett jobb/script eller ett
 * test kraschar den ("cache is not a function"). Den här varianten är beroendefri och
 * fungerar i alla tre miljöerna.
 */
export function singleFlight<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyOf: (...args: A) => string
): (...args: A) => Promise<R> {
  const inFlight = new Map<string, Promise<R>>();
  return (...args: A): Promise<R> => {
    const k = keyOf(...args);
    const running = inFlight.get(k);
    if (running) return running;
    // `finally` FÖRE retur: nyckeln måste städas även när löftet avvisas, annars
    // återanvänds ett trasigt löfte för evigt (och ett DB-glapp blir permanent).
    const p = fn(...args).finally(() => inFlight.delete(k));
    inFlight.set(k, p);
    return p;
  };
}
