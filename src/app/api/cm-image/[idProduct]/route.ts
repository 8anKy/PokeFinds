import { NextResponse } from "next/server";

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
 * Sökvägen är /{shard}/{idProduct}/{idProduct}.{ext}. `shard` är en intern lagrings-bucket
 * (INTE härledbar ur idProduct — mätt: nya produkter i 52/53, senare bucketar i 1014/1015 och
 * 1016+, äldre varierar). Vi PROBAR därför de kända bucketarna × {png,jpg} och memoiserar
 * träffen. CDN:t rate-limitar INTE (till skillnad från CM:s HTML-sidor), så probning är billig.
 *
 * NÄR NYA BILDER SLUTAR LADDA: CM har lagt dem i en NY bucket. Mätt 2026-07-20: alla
 * nyare set-ETB:er (151, Paradox Rift, … idProduct 719691/776336) ligger i 1016 — den
 * saknades här → 404 → trasiga bilder. Lägg till den nya bucketen (verifiera med curl mot
 * product-images.s3.cardmarket.com/{shard}/{id}/{id}.png och referer cardmarket.com).
 */
const SHARDS = [53, 52, 54, 1014, 1015, 1016, 1017, 1018, 51, 55, 50, 56, 57, 58];
const EXTS = ["png", "jpg"];
const REFERER = "https://www.cardmarket.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

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

function candidateUrls(id: string): string[] {
  const urls: string[] = [];
  for (const shard of SHARDS) for (const ext of EXTS)
    urls.push(`https://product-images.s3.cardmarket.com/${shard}/${id}/${id}.${ext}`);
  return urls;
}

async function fetchCmImage(url: string): Promise<Response | null> {
  const res = await fetch(url, { headers: { referer: REFERER, "user-agent": UA } });
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

  for (const url of candidateUrls(id)) {
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
