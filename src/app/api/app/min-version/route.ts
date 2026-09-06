import { NextResponse } from "next/server";
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
 * KOSTNAD: noll Neon (ingen DB), en extern HTTP-hämtning per 10 min per process,
 * i minnet. Appen anropar rutten vid start och när den kommer tillbaka i
 * förgrunden (högst en gång i timmen; bara iOS, bara nativt); webben anropar
 * den aldrig. ⛔ Ingen `unstable_cache`/Data Cache: svaret får inte ligga i
 * ISR-lagret på volymen, och ett processminne räcker.
 *
 * ⛔ KORTA CACHAR, BÅDA (2026-09-06): med 6 h i processen + `jsonCached(3600)`
 * (= 1 h i Railways edge-cache PLUS stale-while-revalidate 5 h) låg 1.2 i
 * butiken sedan 13:30 UTC medan rutten svarade "1.1" över en timme senare, och
 * ägaren på 1.1 fick ingen remsa. Remsan är värdelös om den släpar ett halvt
 * dygn efter släppet. Nu 10 min i processen och 5 min på kanten, INGEN
 * stale-while-revalidate — värsta fallet ~15 min efter att Apples lookup
 * uppdaterats. Trafiken är några dussin anrop per dygn; kanten behöver inte
 * skydda något här.
 *
 * FALLER APPLE BORT (5xx, timeout, oväntad form) svaras golvet med
 * `source: "floor"` — remsan blir då som före 2026-09-02, aldrig felaktig.
 * ⚠️ Apples lookup släpar ibland timmar efter ett släpp: remsan tänds sent,
 * aldrig för tidigt. Det är rätt håll för en knuff.
 *
 * ⛔ Inget `force-dynamic` — det sätter no-store och slår ut cache-headern.
 * `fetch(..., { cache: "no-store" })` gör rutten dynamisk ändå.
 */

const LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}&country=se`;
/**
 * ⛔ APPLES LOOKUP LIGGER BAKOM AKAMAI MED `max-age=86400` (mätt 2026-09-06):
 * 1.2 släpptes 13:30 UTC, ett anrop från Sverige fick 1.2, men Railways process
 * (Frankfurt) fick en DAGSGAMMAL "1.1" ur en annan Akamai-nod (`TCP_MEM_HIT`)
 * och svarade "store: 1.1" i god tro. En avvikande frågesträng är en egen
 * cache-nyckel hos Akamai (`TCP_MISS` verifierat) — därför en tidshink i URL:en:
 * ett origin-anrop per hink, aldrig en dagsgammal kopia.
 */
function lookupUrl(): string {
  return `${LOOKUP_URL}&_=${Math.floor(Date.now() / TTL_MS)}`;
}
const TTL_MS = 10 * 60 * 1000;
// Ett misslyckat uppslag hålls bara så här länge — en störning hos Apple ska
// inte låsa golvet i tio minuter.
const FAIL_TTL_MS = 2 * 60 * 1000;
// Railways edge-cache: kort och utan stale-while-revalidate (se filhuvudet).
const EDGE_SECONDS = 300;
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
    const res = await fetch(lookupUrl(), {
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
      const at = store ? Date.now() : Date.now() - TTL_MS + FAIL_TTL_MS;
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
  return NextResponse.json(
    { ios, floor: MIN_APP_VERSION, source },
    { headers: { "Cache-Control": `public, max-age=${EDGE_SECONDS}, s-maxage=${EDGE_SECONDS}` } }
  );
}
