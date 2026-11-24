/**
 * Läser ett svar som JSON — `null` när kroppen är avklippt eller ogiltig.
 *
 * Prisleverantören stänger då och då anslutningen mitt i ett 200-svar. `r.json()` kastar då
 * ("Unterminated string in JSON"), och ett enda sådant svar bland ~2 700 fällde hela
 * Pokémon-prisjobbet 2026-11-24 — inget pris och ingen grafpunkt det dygnet. Anroparen ska
 * behandla `null` som ett försök som misslyckades och fråga igen, precis som vid 5xx.
 */
export async function jsonOrNull<T>(r: Response): Promise<T | null> {
  try {
    return JSON.parse(await r.text()) as T;
  } catch {
    return null;
  }
}

/** `fetch` som svarar `null` i stället för att kasta på ett nätverksfel (ECONNRESET, avbruten socket). */
export async function fetchOrNull(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}
