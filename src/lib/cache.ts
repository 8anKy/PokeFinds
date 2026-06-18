import { unstable_cache } from "next/cache";

/**
 * TTL-cache för publika läsfrågor. Datan uppdateras ~en gång/dygn av de schemalagda
 * jobben, så ~10 min inaktualitet är OK — och varje cache-träff är en Neon-fråga som
 * INTE körs (sänker network transfer kraftigt).
 *
 * ponytail: bara TTL, ingen tagg-invalidering. Behöver en fråga bustas direkt efter en
 * skrivning, byt till `unstable_cache(..., { tags })` + `revalidateTag`.
 */
export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key: string,
  revalidateSeconds = 600
): (...args: A) => Promise<R> {
  return unstable_cache(fn, [key], { revalidate: revalidateSeconds });
}
