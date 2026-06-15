/**
 * Artig HTTP-hjälpare för datainsamling.
 *
 * ETIK: Vi hämtar bara data som källan tillåter:
 *  - robots.txt kontrolleras och cachas i minnet
 *  - tydlig user-agent med kontaktuppgift
 *  - minsta fördröjning per värd (host) mellan förfrågningar
 *  - exponentiell backoff vid fel (1s/2s/4s)
 *  - vi kringgår ALDRIG captcha, inloggning eller betalväggar
 */

export const BOT_USER_AGENT = "FoilioBot/1.0 (+kontakt: hej@foilio.se)";

/** Standardfördröjning mellan förfrågningar mot samma värd. */
const DEFAULT_DELAY_MS = 1500;

interface RobotsRules {
  disallow: string[];
  allow: string[];
  fetchedAt: number;
}

const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme
const robotsCache = new Map<string, RobotsRules>();
const lastRequestPerHost = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Enkel robots.txt-parser: plockar regler för User-agent: * och vår bot. */
function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], fetchedAt: Date.now() };
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(":");
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua.includes("foiliobot");
    } else if (applies && key === "disallow" && value) {
      rules.disallow.push(value);
    } else if (applies && key === "allow" && value) {
      rules.allow.push(value);
    }
  }
  return rules;
}

/**
 * Kontrollerar om en sökväg är tillåten enligt robots.txt.
 * Cachas i minnet. Om robots.txt inte kan hämtas tillåter vi som standard
 * men loggar händelsen.
 */
export async function checkRobotsTxt(baseUrl: string, path: string): Promise<boolean> {
  let host: string;
  let origin: string;
  try {
    const u = new URL(baseUrl);
    host = u.host;
    origin = u.origin;
  } catch {
    console.warn(`[http] Ogiltig baseUrl för robots-kontroll: ${baseUrl}`);
    return true;
  }

  let rules = robotsCache.get(host);
  if (!rules || Date.now() - rules.fetchedAt > ROBOTS_CACHE_TTL_MS) {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { "user-agent": BOT_USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        rules = parseRobotsTxt(await res.text());
      } else {
        // Ingen robots.txt (404 etc.) → allt tillåtet
        rules = { disallow: [], allow: [], fetchedAt: Date.now() };
      }
    } catch (err) {
      console.warn(
        `[http] Kunde inte hämta robots.txt för ${host} — tillåter som standard.`,
        err instanceof Error ? err.message : err
      );
      rules = { disallow: [], allow: [], fetchedAt: Date.now() };
    }
    robotsCache.set(host, rules);
  }

  // Längsta matchande regel vinner (förenklad standardtolkning)
  const matches = (prefixes: string[]): number =>
    prefixes.reduce((best, p) => (path.startsWith(p) && p.length > best ? p.length : best), -1);
  const allowLen = matches(rules.allow);
  const disallowLen = matches(rules.disallow);
  return allowLen >= disallowLen;
}

export interface PoliteFetchOptions {
  /** Minsta fördröjning mot samma värd (ms). Standard 1500 ms. */
  delayMs?: number;
  /** Antal omförsök vid fel. Standard 3 (backoff 1s/2s/4s). */
  retries?: number;
  headers?: Record<string, string>;
}

/**
 * Hämtar en URL artigt: kontrollerar robots.txt, väntar mellan förfrågningar
 * mot samma värd, identifierar sig som FoilioBot och gör omförsök med
 * exponentiell backoff.
 */
export async function politeFetch(
  url: string,
  options: PoliteFetchOptions = {}
): Promise<Response> {
  const { delayMs = DEFAULT_DELAY_MS, retries = 3, headers = {} } = options;
  const parsed = new URL(url);

  const allowed = await checkRobotsTxt(parsed.origin, parsed.pathname);
  if (!allowed) {
    throw new Error(`robots.txt förbjuder hämtning av ${parsed.pathname} på ${parsed.host}`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Respektera minsta fördröjning per värd
    const last = lastRequestPerHost.get(parsed.host) ?? 0;
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestPerHost.set(parsed.host, Date.now());

    try {
      const res = await fetch(url, {
        headers: { "user-agent": BOT_USER_AGENT, ...headers },
        signal: AbortSignal.timeout(60_000),
      });
      // 429/5xx → backoff och försök igen
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} från ${parsed.host}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < retries) {
      const backoff = 1000 * 2 ** attempt; // 1s, 2s, 4s...
      console.warn(`[http] Försök ${attempt + 1} mot ${url} misslyckades, väntar ${backoff} ms`);
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`politeFetch misslyckades för ${url}`);
}
