/**
 * Vilka PRODUKTER den inloggade bevakar — EN hämtning, delad av alla klockor.
 *
 * Tvillingen till `watched-sets.ts`, av exakt samma skäl: ett katalogrutnät
 * renderar 20-40 `WatchBell` samtidigt, och en fetch per kort hade blivit lika
 * många parallella anrop till samma lista — på sidor som annars är ISR-cachade
 * och inte rör databasen alls.
 *
 * ⛔ Den här listan är dessutom vad som gör klockan ÄRLIG efter en omladdning.
 * Utan den startade varje klocka som "obevakad" och en redan bevakad produkt såg
 * ut att vara det — man kunde bara slå PÅ, aldrig av (rapporterat 2026-08-06).
 */

let cache: Set<string> | null = null;
let inFlight: Promise<Set<string>> | null = null;
let fetchedAt = 0;

/** Kort TTL: listan ändras av användarens egna klick, inte av bakgrundsjobb. */
const TTL_MS = 60_000;

export async function getWatchedProductIds(): Promise<Set<string>> {
  if (cache && Date.now() - fetchedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = fetch("/api/watchlist?ids=1", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { productIds?: string[] } | null) => {
      cache = new Set(d?.productIds ?? []);
      fetchedAt = Date.now();
      return cache;
    })
    // Ett misslyckat anrop får inte cachas som "bevakar ingenting" i en minut —
    // nästa klocka ska få försöka igen.
    .catch(() => new Set<string>())
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Håll cachen i takt när användaren slår på/av, så grannkorten ritar rätt. */
export function setProductWatched(productId: string, watched: boolean): void {
  if (!cache) return;
  if (watched) cache.add(productId);
  else cache.delete(productId);
}

/** Nollställ (utloggning/planbyte) så nästa läsning hämtar färskt. */
export function clearWatchedProductsCache(): void {
  cache = null;
  fetchedAt = 0;
}
