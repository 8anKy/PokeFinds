/**
 * TTL-cache för publika läsfrågor (sänker Neon network transfer).
 *
 * TILLFÄLLIGT AVSTÄNGD (passthrough): `unstable_cache` serialiserar returvärdet →
 * Date-fält kommer tillbaka som STRÄNGAR, och anropare som gör `date.toISOString()`
 * / `date.getTime()` kraschar (TypeError på landningssidan). Återinförs när de
 * cachade funktionerna returnerar serialiserings-säker data (datum som ISO-sträng)
 * + lokal runtime-verifiering. Strukturen behålls så återinförandet blir en ändring.
 */
export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  _key: string,
  _revalidateSeconds = 600
): (...args: A) => Promise<R> {
  return fn;
}
