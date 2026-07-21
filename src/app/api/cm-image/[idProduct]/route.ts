import { NextResponse } from "next/server";
import { CM_IMAGE_HEADERS, cmImageCandidates } from "@/lib/cm-image";

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
 */
// Memoiserar löst URL per idProduct för processens livstid (bilden är oföränderlig).
const resolved = new Map<string, string>();
// NEGATIVA svar memoiseras bara kort. En CDN-hicka mitt i probningen gav annars
// "ingen bild" för resten av processens liv → produkten stod bildlös tills nästa
// deploy, trots att bilden fanns. Samma skäl till att 404:an skickas no-store:
// ett cachat negativt svar överlever den transienta orsaken.
const MISS_TTL_MS = 10 * 60_000;
const missUntil = new Map<string, number>();

function noImage(): NextResponse {
  return new NextResponse("no image", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

async function fetchCmImage(url: string): Promise<Response | null> {
  const res = await fetch(url, { headers: CM_IMAGE_HEADERS });
  return res.ok ? res : null;
}

export async function GET(_req: Request, { params }: { params: { idProduct: string } }) {
  const id = params.idProduct;
  if (!/^\d{3,8}$/.test(id)) return new NextResponse("bad id", { status: 400 });

  const known = resolved.get(id);
  if (known) {
    const hit = await fetchCmImage(known);
    if (hit) return stream(hit, known);
    resolved.delete(id); // CDN-hicka → prova om nedan
  }

  // Färsk miss → hoppa probningen (28 requests) tills TTL:en gått ut.
  const until = missUntil.get(id);
  if (until != null && until > Date.now()) return noImage();

  for (const url of cmImageCandidates(id)) {
    const hit = await fetchCmImage(url);
    if (hit) {
      resolved.set(id, url);
      missUntil.delete(id);
      return stream(hit, url);
    }
  }
  missUntil.set(id, Date.now() + MISS_TTL_MS);
  return noImage();
}

/**
 * Content-type härleds ur filändelsen, INTE ur CM:s S3-svar: en del av deras objekt
 * har en trasig upladdnings-MIME ("multerS3.AUTO_CONTENT_TYPE") som inte renderar i <img>.
 */
function stream(res: Response, url: string): NextResponse {
  const contentType = url.endsWith(".png") ? "image/png" : "image/jpeg";
  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
