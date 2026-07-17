import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Bilden är oföränderlig per idProduct → låt Next/plattformen cacha svaret hårt.
export const revalidate = 31536000;

/**
 * Cardmarket-produktbild-proxy. Cardmarkets bild-CDN (product-images.s3.cardmarket.com)
 * BLOCKERAR hotlinkning: en GET utan `Referer: cardmarket.com` ger 403. Vi kan därför inte
 * peka <img src> direkt på den. Den här routen hämtar bilden server-sida MED referer och
 * strömmar tillbaka den, cachad oföränderligt. imageUrl sätts till /api/cm-image/{idProduct}.
 *
 * Sökvägen är /{shard}/{idProduct}/{idProduct}.{ext}. `shard` är en intern lagrings-bucket
 * (INTE härledbar ur idProduct — mätt: nya produkter i 52/53, en andra bucket i 1014/1015,
 * äldre varierar). Vi PROBAR därför de kända bucketarna × {png,jpg} och memoiserar träffen.
 * CDN:t rate-limitar INTE (till skillnad från CM:s HTML-sidor), så probning är billig.
 */
const SHARDS = [53, 52, 54, 1014, 1015, 51, 55, 50, 56, 57, 58];
const EXTS = ["png", "jpg"];
const REFERER = "https://www.cardmarket.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Memoiserar löst URL (eller null = ingen bild finns) per idProduct för processens livstid.
const resolved = new Map<string, string | null>();

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

  // Redan löst (URL eller null)?
  if (resolved.has(id)) {
    const url = resolved.get(id);
    if (!url) return new NextResponse("no image", { status: 404 });
    const hit = await fetchCmImage(url);
    if (hit) return stream(hit);
    resolved.delete(id); // CDN-hicka → prova om nedan
  }

  for (const url of candidateUrls(id)) {
    const hit = await fetchCmImage(url);
    if (hit) {
      resolved.set(id, url);
      return stream(hit);
    }
  }
  resolved.set(id, null);
  return new NextResponse("no image", { status: 404 });
}

function stream(res: Response): NextResponse {
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
