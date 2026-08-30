/**
 * TCGdex (api.tcgdex.net) — EN hämtväg för alla batch-skript.
 *
 * VARFÖR: 2026-08-30 vägrade api.tcgdex.net TCP-anslutningar från GitHub-runnern
 * (ETIMEDOUT på både v4 och v6 i `internalConnectMultiple`) i ett par minuter.
 * Nämnarsteget och bildlagningen i `import-new-sets.yml` anropade `fetch()` BART —
 * ingen timeout, inga omförsök, ingen fail-soft — så båda dog på FÖRSTA anropet
 * medan pokemontcg.io (som går via `politeFetch` med backoff) överlevde två
 * misslyckade försök i samma körning. `politeFetch` passar inte här: den håller
 * 1,5 s per anrop mot samma värd, och nämnarräkningen gör ~20 000 kortanrop.
 *
 * KONTRAKT:
 *  · 2xx  → JSON.
 *  · 404 (och övriga 4xx utom 429) → `null` = "finns inte hos TCGdex". Det är ett
 *    DATA-svar, inte ett fel, och skiljs från nätverksfel just för att anroparen
 *    ska kunna behandla "de vet inte" (0 = OKÄNT) annorlunda än "vi kunde inte
 *    fråga" (behåll det vi visste).
 *  · Nätverksfel / timeout / 429 / 5xx → omförsök med backoff (1 s, 2 s, 4 s),
 *    sedan `TcgdexUnavailable`. Anroparen väljer själv om steget ska hoppa över
 *    källan eller falla.
 */

export const TCGDEX_BASE = "https://api.tcgdex.net/v2";

const UA = { "User-Agent": "FoilioBot/1.0 (+https://foilio.se)" };

export class TcgdexUnavailable extends Error {
  constructor(url: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`TCGdex svarade inte: ${url} (${why})`);
    this.name = "TcgdexUnavailable";
  }
}

export interface TcgdexFetchOptions {
  /** Antal OMFÖRSÖK efter det första försöket. Standard 3 (⇒ 4 försök). */
  retries?: number;
  /** Timeout per försök. Standard 15 s — ett hängande anrop ska aldrig låsa en mapPool-plats. */
  timeoutMs?: number;
  /** Injicerbar för test. */
  fetchImpl?: typeof fetch;
  /** Injicerbar för test — standard väntar på riktigt. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Är svaret värt ett omförsök? 429 = "för fort", 5xx = deras fel. 4xx i övrigt = svaret. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function tcgdexJson<T>(url: string, options: TcgdexFetchOptions = {}): Promise<T | null> {
  const { retries = 3, timeoutMs = 15_000, fetchImpl = fetch, sleep = realSleep } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return (await r.json()) as T;
      if (!isRetryableStatus(r.status)) return null;
      lastError = new Error(`HTTP ${r.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw new TcgdexUnavailable(url, lastError);
}
