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

export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key: string,
  revalidateSeconds = 3600,
  tags: string[] = [PRICE_CACHE_TAG]
): (...args: A) => Promise<R> {
  return unstable_cache(fn, [key], { revalidate: revalidateSeconds, tags });
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
