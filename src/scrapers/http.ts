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

/**
 * Hur många förfrågningar vi gjort mot varje värd i den här processen.
 *
 * ⛔ ARTIGHET SKA MÄTAS, INTE GISSAS (2026-08-16). Discord-lanen satte tidigare sin
 * takt per PLATTFORM ("Shopify varje minut, egna servrar varannan"), som om alla
 * butiker kostade lika mycket att hämta. De gör inte det: en butik vars hela feed är
 * två sidhämtningar och en vars feed är trettio kollektionsanrop får då femton
 * gångers skillnad i last utan att någon valt det. Räknaren gör det möjligt att i
 * stället sätta ETT tak på förfrågningar per butik och sekund och låta
 * pollningstakten falla ut ur det — se `intervalForSource` i
 * scripts/discord-restock-run.ts.
 */
const requestsPerHost = new Map<string, number>();

/**
 * Ögonblicksbild av räknaren (värd → antal). Anroparen tar en före och en efter en
 * hämtning och jämför.
 *
 * ⛔ RETURNERAR HELA KARTAN, INTE EN ENDA VÄRD. En källas registrerade `baseUrl` är
 * inte alltid den värd adaptern faktiskt hämtar från — Dragon's Lair står som
 * `https://www.dragonslair.se` medan feeden ligger på `dragonslair.se`. En uppslagning
 * på bara baseUrl-värden gav därför noll förfrågningar för dem, dvs mätningen såg ut
 * att fungera och gjorde det inte. Anroparen får matcha på flera värdformer.
 */
export function requestCountSnapshot(): Record<string, number> {
  return Object.fromEntries(requestsPerHost);
}

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

/** Fler hopp än så är en loop, inte en flytt. */
const MAX_REDIRECTS = 5;

/**
 * Är omdirigeringen kvar på SAMMA sajt (samma registrerbara domän, www eller inte)?
 *
 * ⛔ VARFÖR VI FÖLJER OMDIRIGERINGAR SJÄLVA (2026-09-05). goblinen.com svarar 301 →
 * www.goblinen.com på `/products/<handle>.js`, och Nodes fetch (undici) STRYKER
 * `cookie` (liksom authorization och host) så fort origin byts — även när bytet
 * bara är butikens egen www-värd. Vår `localization=SE`-pinne försvann alltså på
 * vägen, och från GitHub-runnern (US) serverade Shopify Markets ex-moms-priset:
 * 639,20 kr för en ETB som kostar 799 kr. Alla fem bevakade Goblinen-länkar bar
 * ×0,8-priser medan products.json (200 direkt på apex, ingen omdirigering) var
 * rätt — därför syntes felet BARA på bevakade länkar. Belagt: www direkt med
 * US-cookie ⇒ 63920, apex via omdirigering med samma cookie ⇒ geo-priset.
 *
 * Regeln: inom samma sajt behåller hoppet våra headers; till en annan domän följs
 * det som förut, utan dem — en cookie ska aldrig läcka till tredje part.
 */
export function isSameSiteRedirect(from: URL, to: URL): boolean {
  if (to.protocol !== "https:" && to.protocol !== "http:") return false;
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  const a = strip(from.hostname);
  const b = strip(to.hostname);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
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
  // Omdirigeringar följs för hand (se isSameSiteRedirect): `target` är den URL vi
  // står på just nu, hoppen räknas för sig och kostar inget omförsök.
  let target = parsed;
  let hops = 0;
  let attempt = 0;
  while (attempt <= retries) {
    // Respektera minsta fördröjning per värd
    const last = lastRequestPerHost.get(target.host) ?? 0;
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestPerHost.set(target.host, Date.now());
    requestsPerHost.set(target.host, (requestsPerHost.get(target.host) ?? 0) + 1);

    let redirectTo: URL | null = null;
    try {
      const res = await fetch(target.toString(), {
        headers: { "user-agent": BOT_USER_AGENT, ...headers },
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        redirectTo = new URL(location, target);
      } else if (res.status === 429 || res.status >= 500) {
        // 429/5xx → backoff och försök igen
        lastError = new Error(`HTTP ${res.status} från ${target.host}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }

    if (redirectTo) {
      if (++hops > MAX_REDIRECTS) {
        throw new Error(`för många omdirigeringar från ${parsed.host} (${hops})`);
      }
      if (!isSameSiteRedirect(target, redirectTo)) {
        // Annan sajt: följ utan våra egna headers — exakt vad fetch hade gjort själv.
        return fetch(redirectTo.toString(), {
          headers: { "user-agent": BOT_USER_AGENT },
          signal: AbortSignal.timeout(60_000),
        });
      }
      if (!(await checkRobotsTxt(redirectTo.origin, redirectTo.pathname))) {
        throw new Error(
          `robots.txt förbjuder hämtning av ${redirectTo.pathname} på ${redirectTo.host}`
        );
      }
      target = redirectTo;
      continue;
    }

    attempt++;
    if (attempt <= retries) {
      const backoff = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s...
      console.warn(`[http] Försök ${attempt} mot ${url} misslyckades, väntar ${backoff} ms`);
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`politeFetch misslyckades för ${url}`);
}
