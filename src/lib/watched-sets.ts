/**
 * Vilka set den inloggade bevakar — EN hämtning, delad av alla klockor på sidan.
 *
 * ⛔ Hämta ALDRIG per kort. Ett katalogrutnät renderar 20-40 `WatchBell` samtidigt
 * och en fetch i varje hade blivit lika många parallella anrop till samma lilla
 * lista — och lika många Neon-väckningar, på sidor som annars är ISR-cachade och
 * inte rör databasen alls. Samma mönster som `product-actions.tsx` använder för
 * "bevakas redan", fast delat mellan komponenterna i stället för per instans.
 *
 * En in-flight-promise gör att korten som monterar i samma renderingssvep delar
 * ETT anrop (samma grepp som konstindexets lata inläsning i scanner/art-index).
 */

let cache: Set<string> | null = null;
let inFlight: Promise<Set<string>> | null = null;

/** Hur länge listan får återanvändas. Kort: den ändras av användarens egna klick. */
const TTL_MS = 60_000;
let fetchedAt = 0;

export async function getWatchedSetIds(): Promise<Set<string>> {
  if (cache && Date.now() - fetchedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = fetch("/api/set-watch?ids=1", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { setIds?: string[] } | null) => {
      cache = new Set(d?.setIds ?? []);
      fetchedAt = Date.now();
      return cache;
    })
    // Ett misslyckat anrop får inte cachas som "bevakar inga set" för en hel
    // minut — nästa klocka ska få försöka igen.
    .catch(() => new Set<string>())
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Håll cachen i takt när användaren själv slår på/av en bevakning, så att
 * grannkorten i samma rutnät ritar om till rätt tillstånd utan omladdning.
 */
export function setSetWatched(setId: string, watched: boolean): void {
  if (!cache) return;
  if (watched) cache.add(setId);
  else cache.delete(setId);
}

/** Nollställ (utloggning/planbyte) så nästa läsning hämtar färskt. */
export function clearWatchedSetsCache(): void {
  cache = null;
  fetchedAt = 0;
}
