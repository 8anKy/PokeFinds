import { jsonCached } from "@/lib/api";
import { IOS_BUNDLE_ID, MIN_APP_VERSION, resolveMinAppVersion } from "@/lib/app-version";

/**
 * GET /api/app/min-version — vilken app-version ligger i App Store just nu?
 *
 * Driver "Ny version finns"-remsan (components/update-banner.tsx) utan att någon
 * behöver höja en konstant efter varje granskning: Apples publika lookup-API
 * (ingen nyckel, ingen kvot att tala om) svarar med den version som är SLÄPPT
 * i den svenska butiken — dvs exakt den version användaren kan hämta. Svaret
 * är aldrig lägre än golvet `MIN_APP_VERSION` (lib/app-version.ts).
 *
 * KOSTNAD: noll Neon (ingen DB), en extern HTTP-hämtning per 6 h per process,
 * i minnet. Appen anropar rutten en gång per start (bara iOS, bara nativt);
 * webben anropar den aldrig. ⛔ Ingen `unstable_cache`/Data Cache: svaret får
 * inte ligga i ISR-lagret på volymen, och ett processminne räcker för sex timmar.
 *
 * FALLER APPLE BORT (5xx, timeout, oväntad form) svaras golvet med
 * `source: "floor"` — remsan blir då som före 2026-09-02, aldrig felaktig.
 * ⚠️ Apples lookup släpar ibland timmar efter ett släpp: remsan tänds sent,
 * aldrig för tidigt. Det är rätt håll för en knuff.
 *
 * ⛔ Inget `force-dynamic` — det sätter no-store och slår ut cache-headern
 * (se jsonCached). `fetch(..., { cache: "no-store" })` gör rutten dynamisk ändå.
 */

const LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}&country=se`;
const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

interface Cached {
  ios: string;
  source: "store" | "floor";
  at: number;
}
let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

async function lookupStoreVersion(): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(LOOKUP_URL, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "user-agent": "Foilio/1.0 (+https://foilio.se)" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: { version?: unknown }[] };
    const v = json.results?.[0]?.version;
    return typeof v === "string" && /^\d+(\.\d+)*$/.test(v.trim()) ? v.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function current(): Promise<Cached> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  if (!inFlight) {
    inFlight = (async () => {
      const store = await lookupStoreVersion();
      const ios = resolveMinAppVersion(store);
      // Ett misslyckat uppslag cachas KORTARE (30 min) så en tillfällig störning
      // hos Apple inte låser golvet i sex timmar.
      const at = store ? Date.now() : Date.now() - TTL_MS + 30 * 60 * 1000;
      cache = { ios, source: store && ios === store ? "store" : "floor", at };
      return cache;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export async function GET() {
  const { ios, source } = await current();
  return jsonCached({ ios, floor: MIN_APP_VERSION, source }, 3600);
}
