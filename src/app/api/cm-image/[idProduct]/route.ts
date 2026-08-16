import { NextResponse } from "next/server";
import {
  CM_IMAGE_HEADERS,
  CM_IMAGE_PROBE_TIMEOUT_MS,
  cmResolveImageUrl,
} from "@/lib/cm-image";
import { clientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Bilden är oföränderlig per idProduct, men Next route-cachen cachar ÄVEN ett
// 404 "no image" som en transient CDN-hicka råkat producera — med ett års
// revalidate satt bilden då bildlös resten av deployen. Route-cachen hålls därför
// kort (en timme = negativa svar självläker) medan den riktiga cachningen ligger i
// svarets `immutable`-header, som webbläsare/edge håller i ett år.
export const revalidate = 3600;

/**
 * Cardmarket-produktbild-proxy. Cardmarkets bild-CDN (product-images.s3.cardmarket.com)
 * BLOCKERAR hotlinkning: en GET utan `Referer: cardmarket.com` ger 403. Vi kan därför inte
 * peka <img src> direkt på den. Den här routen hämtar bilden server-sida MED referer och
 * strömmar tillbaka den, cachad oföränderligt. imageUrl sätts till /api/cm-image/{idProduct}.
 *
 * Bucket-listan och probningen bor i @/lib/cm-image (delas med cardmarket-refresh, som
 * måste veta OM en render finns innan den pekar en produkt hit — långt ifrån alla
 * sealed-SKU:er har en).
 *
 * ⛔ Routen är en FÖRSTÄRKNINGSYTA: id-rummet är ~100 miljoner värden och varje OKÄNT id
 * kostar 28 utgående requests mot CM:s CDN. Värsta utfallet är inte vår nota — det är att
 * CDN:t blockerar vår utgående IP, och då blir HELA sealed-katalogen bildlös. Därför
 * IP-broms på PROBNINGEN (se nedan) och tak på minnesmapparna.
 */
// Memoiserar löst URL per idProduct för processens livstid (bilden är oföränderlig).
const resolved = new Map<string, string>();
// NEGATIVA svar memoiseras bara kort. En CDN-hicka mitt i probningen gav annars
// "ingen bild" för resten av processens liv → produkten stod bildlös tills nästa
// deploy, trots att bilden fanns. Samma skäl till att 404:an skickas no-store:
// ett cachat negativt svar överlever den transienta orsaken.
const MISS_TTL_MS = 10 * 60_000;
const missUntil = new Map<string, number>();

// Tak på mapparna: nycklarna kommer från URL:en, inte från katalogen, så en skanner som
// itererar id-rummet skulle annars låta RSS växa med upptiden (Railway-heapen är capad
// till 512 MB). Katalogen har ~2100 sealed-SKU:er → taken rymmer hela arbetsmängden.
const MAX_RESOLVED = 5000;
const MAX_MISSES = 5000;

/** LRU-insättning: Map:en bevarar insättningsordning, så äldst = först ut. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key); // återinsättning flyttar nyckeln sist = nyast
  map.set(key, value);
  while (map.size > max) {
    const oldest: string | undefined = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

// Probningen (28 utgående requests) är den dyra vägen — bromsen sitter DÄR, inte på
// varje visning: en katalogsida drar dussintals bilder och en broms på allt hade
// gjort ärliga sidor bildlösa. Kallstart av en lång sealed-lista ryms under taket,
// medan en id-skanner slår i det efter ~2 sekunders arbete.
const PROBE_LIMIT = 120;
const PROBE_WINDOW_MS = 60_000;

function noImage(): NextResponse {
  return new NextResponse("no image", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Hämtar bilden och läser HELA kroppen innan vi svarar.
 *
 * Timeouten måste finnas (en hängande S3-anslutning får inte binda en request i minuter),
 * men på en STRÖMMAD kropp blir `AbortSignal.timeout` ett transferbudget: en långsam
 * mobilklient bakåttrycker, källan pausas och bilden hade kapats mitt i. CM-renders är
 * ~50–300 KB, så vi buffrar dem och släpper CM-anslutningen innan klienten börjar läsa.
 */
async function fetchCmImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      headers: CM_IMAGE_HEADERS,
      signal: AbortSignal.timeout(CM_IMAGE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: { idProduct: string } }) {
  const id = params.idProduct;
  if (!/^\d{3,8}$/.test(id)) return new NextResponse("bad id", { status: 400 });

  const known = resolved.get(id);
  if (known) {
    const hit = await fetchCmImage(known);
    // ⚠️ Ingen läsning av `req` i den här grenen med flit: Next avstatiserar routen så
    // fort request-objektet rörs, och då tappar vi route-cachen för de bilder som ALLTID
    // träffar. Bromsen behövs inte här — en känd URL är ett round-trip, ingen förstärkning.
    if (hit) {
      remember(resolved, id, known, MAX_RESOLVED); // touch → LRU-ordning
      return stream(hit, known);
    }
    resolved.delete(id); // CDN-hicka → prova om nedan
  }

  // Färsk miss → hoppa probningen (28 requests) tills TTL:en gått ut.
  const until = missUntil.get(id);
  if (until != null && until > Date.now()) return noImage();

  const { ok } = await rateLimit(`cm-image-probe:${clientIp(req)}`, PROBE_LIMIT, PROBE_WINDOW_MS);
  // 429 får ALDRIG cachas och får ALDRIG skriva missUntil — annars hade en bromsad
  // klient gjort produkten bildlös i tio minuter för alla som delar processen.
  if (!ok) {
    return new NextResponse("rate limited", {
      status: 429,
      headers: { "cache-control": "no-store" },
    });
  }

  const url = await cmResolveImageUrl(id);
  if (url) {
    const hit = await fetchCmImage(url);
    if (hit) {
      remember(resolved, id, url, MAX_RESOLVED);
      missUntil.delete(id);
      return stream(hit, url);
    }
  }
  remember(missUntil, id, Date.now() + MISS_TTL_MS, MAX_MISSES);
  return noImage();
}

/**
 * Content-type härleds ur filändelsen, INTE ur CM:s S3-svar: en del av deras objekt
 * har en trasig upladdnings-MIME ("multerS3.AUTO_CONTENT_TYPE") som inte renderar i <img>.
 */
function stream(body: ArrayBuffer, url: string): NextResponse {
  const contentType = url.endsWith(".png") ? "image/png" : "image/jpeg";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
