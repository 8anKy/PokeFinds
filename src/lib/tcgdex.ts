/**
 * TCGdex (api.tcgdex.net) — EN hämtväg för alla batch-skript och jobb.
 *
 * VARFÖR (2026-08-30): api.tcgdex.net ligger bakom ClouDNS GeoDNS med TRE speglar —
 * Nordamerika → 198.27.75.82 (OVH Kanada), Frankrike → 51.68.233.163, övriga →
 * 217.182.193.43. MÄTT med Google DoH + EDNS Client Subnet: svaret följer klientens
 * prefix, TTL 21 600 s. GitHub-runnern (Azure US-East, ingen IPv6) får den kanadensiska
 * spegeln, och den var DÖD: curl v4 = SYN-timeout efter 20 s, Nodes fetch =
 * UND_ERR_CONNECT_TIMEOUT, medan samma URL svarade 200 på 0,2 s från Sverige.
 * Nämnarsteget och bildlagningen i `import-new-sets.yml` anropade `fetch()` bart —
 * ingen timeout, inga omförsök, ingen fail-soft — och dog på första anropet, medan de
 * nattliga jobben (cardtrader-reverse, jp-set-label) svalde felet TYST och tappade
 * TCGdex-data i veckor utan en röd körning. `politeFetch` passar inte här: 1,5 s per
 * anrop mot samma värd × ~20 000 kortanrop i nämnarräkningen.
 *
 * KONTRAKT:
 *  · 2xx  → JSON.
 *  · 404 (och övriga 4xx utom 429) → `null` = "finns inte hos TCGdex". Det är ett
 *    DATA-svar, inte ett fel, och skiljs från nätverksfel just för att anroparen ska
 *    kunna behandla "de vet inte" (0 = OKÄNT) annorlunda än "vi kunde inte fråga"
 *    (behåll det vi visste).
 *  · Nätverksfel / timeout / 429 / 5xx → omförsök med backoff (1 s, 2 s, 4 s).
 *  · Nätverksfel efter alla omförsök → DNS-FALLBACK: fråga Google DoH vilka adresser
 *    ANDRA regioner får (EDNS Client Subnet), prova dem pinnade en i taget och PINNA
 *    den första som svarar för resten av processen. Certifikatet valideras mot
 *    värdnamnet som vanligt — bara adressuppslaget byts ut.
 *  · Ger även det upp → `TcgdexUnavailable`, och KRETSBRYTAREN öppnas i 10 min: alla
 *    anrop kastar direkt, utan fetch och utan sömn. MÄTT (körning 33324672536): utan
 *    brytaren tog bildlagningen > 29 min mot ett dött TCGdex — två anrop à (försök +
 *    1 s sömn + försök) per kort med död bild — och slog i 30-minuterstaket. Normalt
 *    1,5–2,5 min. En nedtid ska kosta EN väntan, inte en per kort.
 */
import https from "node:https";

export const TCGDEX_BASE = "https://api.tcgdex.net/v2";

const UA = { "User-Agent": "FoilioBot/1.0 (+https://foilio.se)" };

export class TcgdexUnavailable extends Error {
  constructor(url: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`TCGdex svarade inte: ${url} (${why})`);
    this.name = "TcgdexUnavailable";
  }
}

/** Ett HTTP-svar vi FICK men inte gillade (429/5xx). Skiljs från nätverksfel i fallbacken. */
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

/** Det lilla vi behöver ur ett svar — `Response` uppfyller det strukturellt. */
export interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
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
  /** Injicerbar för test: vilka adresser andra regioner får för värden. Standard = Google DoH. */
  resolveAlternatives?: (host: string) => Promise<string[]>;
  /** Injicerbar för test: hämtning pinnad till en IP-adress. */
  getViaAddress?: (url: string, address: string, timeoutMs: number) => Promise<JsonResponse>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const TCGDEX_BREAKER_MS = 10 * 60_000;
let breakerOpenUntil = 0;
/** Adress som bevisligen svarar när systemets DNS pekar på en död spegel. Per process. */
let pinnedAddress: string | null = null;

/** Bara för test. */
export function resetTcgdexState(): void {
  breakerOpenUntil = 0;
  pinnedAddress = null;
}

/** Bara för loggning/test. */
export function tcgdexPinnedAddress(): string | null {
  return pinnedAddress;
}

/** Är svaret värt ett omförsök? 429 = "för fort", 5xx = deras fel. 4xx i övrigt = svaret. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Prefix vi frågar GeoDNS:en "som". `0.0.0.0/0` = utan klientprefix (svaret följer då
 * resolverns egen plats). De två andra är /24:orna där TCGdex:s EUROPEISKA speglar
 * står (OVH Frankrike, mätt 2026-08-30) — de används bara som "en klient i Europa"-
 * vink, och en flytt av speglarna ändrar bara vilket SVAR vinken ger, inte att den
 * fungerar. Alla distinkta A-svar provas; ordningen spelar ingen roll.
 */
export const ECS_PROBES = ["0.0.0.0/0", "217.182.193.0/24", "51.68.233.0/24"] as const;

/** Distinkta IPv4-adresser som GeoDNS:en ger olika regioner. Tom lista vid fel. */
export async function resolveViaDoh(host: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const out = new Set<string>();
  for (const subnet of ECS_PROBES) {
    try {
      const r = await fetchImpl(
        `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A&edns_client_subnet=${subnet}`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (!r.ok) continue;
      const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of j.Answer ?? []) {
        if (a.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(a.data)) out.add(a.data);
      }
    } catch {
      /* nästa sond */
    }
  }
  return [...out];
}

/**
 * GET JSON med adressuppslaget UTBYTT: TLS-SNI och certifikatkontroll använder
 * fortfarande värdnamnet ur URL:en, bara TCP-anslutningen går till `address`.
 * `node:https` i stället för `fetch` för att undici inte exponerar `lookup`.
 */
export function getJsonViaAddress(url: string, address: string, timeoutMs: number): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const lookup = (_host: string, opts: unknown, cb: (...args: unknown[]) => void) => {
      if ((opts as { all?: boolean } | undefined)?.all) cb(null, [{ address, family: 4 }]);
      else cb(null, address, 4);
    };
    const req = https.get(
      url,
      // `lookup` är ett net.connect-alternativ som http.request släpper igenom; typerna
      // i @types/node är snävare än vad Node accepterar.
      { headers: UA, lookup: lookup as unknown as undefined, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(body) as unknown,
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout efter ${timeoutMs} ms mot ${address}`)));
    req.on("error", reject);
  });
}

export async function tcgdexJson<T>(url: string, options: TcgdexFetchOptions = {}): Promise<T | null> {
  const {
    retries = 3,
    timeoutMs = 15_000,
    fetchImpl = fetch,
    sleep = realSleep,
    resolveAlternatives = resolveViaDoh,
    getViaAddress = getJsonViaAddress,
  } = options;
  if (breakerOpenUntil > Date.now()) {
    throw new TcgdexUnavailable(url, new Error("kretsbrytaren är öppen efter tidigare fel"));
  }

  const get = (): Promise<JsonResponse> =>
    pinnedAddress
      ? getViaAddress(url, pinnedAddress, timeoutMs)
      : fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await get();
      if (r.ok) return (await r.json()) as T;
      if (!isRetryableStatus(r.status)) return null;
      lastError = new HttpStatusError(r.status);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }

  // Nätverksfel (inte ett HTTP-svar): systemets DNS kan ha gett en död spegel.
  // Prova adresserna andra regioner får; en som redan provats (den pinnade) hoppas över.
  let host: string | null = null;
  try {
    host = new URL(url).host;
  } catch {
    /* ogiltig URL — ingen adress att byta ut */
  }
  if (host && !(lastError instanceof HttpStatusError)) {
    const tried = pinnedAddress;
    for (const address of await resolveAlternatives(host)) {
      if (address === tried) continue;
      try {
        const r = await getViaAddress(url, address, timeoutMs);
        if (r.ok || !isRetryableStatus(r.status)) {
          pinnedAddress = address;
          console.warn(
            `TCGdex: adressen systemets DNS gav för ${host} svarar inte — pinnar ${address} för resten av körningen.`
          );
          return r.ok ? ((await r.json()) as T) : null;
        }
      } catch {
        /* nästa adress */
      }
    }
  }

  breakerOpenUntil = Date.now() + TCGDEX_BREAKER_MS;
  throw new TcgdexUnavailable(url, lastError);
}
