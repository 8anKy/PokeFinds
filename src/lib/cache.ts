import { unstable_cache } from "next/cache";

/**
 * TTL-cache för publika läsfrågor. Datan uppdateras ~en gång/dygn av de schemalagda
 * jobben, så ~10 min inaktualitet är OK — varje cache-träff är en Neon-fråga + en
 * Vercel-funktionskörning som UTEBLIR (sänker både egress och Fluid Active CPU).
 *
 * VIKTIGT: `unstable_cache` serialiserar returvärdet → Date-fält blir STRÄNGAR vid
 * cache-träff. Anropare som gör datummatematik på cachad data MÅSTE wrappa i
 * `new Date(x)` (tål både Date och sträng). Annars kraschar sidan (TypeError).
 *
 * ponytail: bara TTL, ingen tagg-invalidering.
 */
export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key: string,
  revalidateSeconds = 600
): (...args: A) => Promise<R> {
  return unstable_cache(fn, [key], { revalidate: revalidateSeconds });
}
