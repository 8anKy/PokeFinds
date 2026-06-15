/**
 * Live EUR→SEK (och USD→SEK) växelkurs via Frankfurter (gratis, ingen nyckel):
 *   https://api.frankfurter.dev/v1/latest?base=EUR&symbols=SEK,USD
 *   → { base:"EUR", date:"YYYY-MM-DD", rates:{ SEK:10.928, USD:1.1567 } }
 *
 * Priser lagras i öre vid ingest. `getRatesOre()` hämtar färsk kurs (max en
 * gång per dygn, cachad i `.cache/exchange-rate.json`) och uppdaterar den
 * modul-lokala `current` som `getCachedRatesOre()` returnerar synkront. Vid
 * nätverksfel faller vi tillbaka på disk-cache → konstanter, så ingest aldrig
 * blockeras av en otillgänglig kurs-API.
 *
 * Manuell pin: sätt `EUR_SEK` i .env (t.ex. EUR_SEK=11.50) för att låsa
 * EUR-kursen (USD hämtas/cachas fortfarande live).
 *
 * fs/path importeras lazy med webpackIgnore eftersom modulen nås av
 * scrapers/adapters som bundlas in i Edge-grafen (instrumentation → scheduler
 * → runner). Koden körs aldrig på Edge (runtime-vakt i instrumentation.ts).
 */

/** Sista utväg om både kurs-API och disk-cache saknas. 1 EUR = 1150 öre. */
export const EUR_FALLBACK_ORE = 1150;
/** Sista utväg för USD. 1 USD = 1050 öre. */
export const USD_FALLBACK_ORE = 1050;

const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=SEK,USD";
const CACHE_REL = ".cache/exchange-rate.json";

export interface RatesOre {
  /** Öre per 1 EUR (t.ex. 1093 = 10,93 SEK/EUR). */
  eurToOre: number;
  /** Öre per 1 USD. */
  usdToOre: number;
}

interface RateCache extends RatesOre {
  /** YYYY-MM-DD (UTC) — dagen kursen hämtades. Cache färsk om === idag. */
  date: string;
  fetchedAt: string;
}

let current: RatesOre = {
  eurToOre: EUR_FALLBACK_ORE,
  usdToOre: USD_FALLBACK_ORE,
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** EUR_SEK i .env låser EUR-kursen (öre). Null = ingen pin. */
function envEurOrePin(): number | null {
  const v = process.env.EUR_SEK;
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

async function readCache(): Promise<RateCache | null> {
  try {
    const fs = await import(/* webpackIgnore: true */ "node:fs");
    const path = await import(/* webpackIgnore: true */ "node:path");
    const file = path.join(process.cwd(), CACHE_REL);
    if (!fs.existsSync(file)) return null;
    const c = JSON.parse(fs.readFileSync(file, "utf8")) as RateCache;
    if (c.eurToOre > 0 && c.usdToOre > 0) return c;
  } catch {
    // korrupt/oläsbar cache → ignorera
  }
  return null;
}

async function writeCache(r: RatesOre): Promise<void> {
  try {
    const fs = await import(/* webpackIgnore: true */ "node:fs");
    const path = await import(/* webpackIgnore: true */ "node:path");
    const dir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cache: RateCache = {
      ...r,
      date: todayUtc(),
      fetchedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(process.cwd(), CACHE_REL),
      JSON.stringify(cache, null, 2)
    );
  } catch {
    // skrivfel ska aldrig blockera ingest
  }
}

/** Applicera ev. EUR-pin ovanpå en kurs (USD oförändrad). */
function withPin(r: RatesOre, pin: number | null): RatesOre {
  return pin ? { eurToOre: pin, usdToOre: r.usdToOre } : r;
}

/**
 * Färsk kurs i öre. Ordning: dagsfärsk disk-cache → Frankfurter → (vid fel)
 * stale disk-cache → konstanter. EUR_SEK-pin appliceras alltid sist.
 * Uppdaterar den modul-lokala cachen som `getCachedRatesOre()` läser.
 */
export async function getRatesOre(): Promise<RatesOre> {
  const pin = envEurOrePin();
  const cached = await readCache();

  // Dagsfärsk cache räcker — Frankfurter uppdateras max en gång per arbetsdag.
  if (cached && cached.date === todayUtc()) {
    current = withPin(cached, pin);
    return current;
  }

  try {
    const res = await fetch(FRANKFURTER_URL, {
      headers: { "User-Agent": "Foilio/1.0 (+https://foilio.se)" },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        rates?: { SEK?: number; USD?: number };
      };
      const sek = json.rates?.SEK;
      const usd = json.rates?.USD;
      if (sek && sek > 0 && usd && usd > 0) {
        const fresh: RatesOre = {
          eurToOre: Math.round(sek * 100),
          usdToOre: Math.round((sek / usd) * 100),
        };
        await writeCache(fresh);
        current = withPin(fresh, pin);
        return current;
      }
    }
  } catch {
    // nätverksfel → fall igenom till fallback
  }

  const fallback: RatesOre = cached
    ? { eurToOre: cached.eurToOre, usdToOre: cached.usdToOre }
    : { eurToOre: EUR_FALLBACK_ORE, usdToOre: USD_FALLBACK_ORE };
  current = withPin(fallback, pin);
  return current;
}

/**
 * Senast kända kurs utan nätverk/IO (synkront). Anropa `getRatesOre()` först i
 * en körning för att uppdatera den; annars returneras fallback-konstanterna.
 */
export function getCachedRatesOre(): RatesOre {
  return current;
}
