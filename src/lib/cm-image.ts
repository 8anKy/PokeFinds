/**
 * Cardmarkets produktbilder — delad kunskap om var de ligger.
 *
 * Sökvägen är `/{shard}/{idProduct}/{idProduct}.{png|jpg}` där `shard` är en intern
 * lagrings-bucket som INTE går att härleda ur idProduct (mätt: nya produkter i 52/53,
 * senare bucketar i 1014/1015 och 1016+, äldre varierar). Vi probar därför de kända
 * bucketarna. CDN:t referer-gatear men rate-limitar INTE (till skillnad från CM:s
 * HTML-sidor), så probning är billig.
 *
 * NÄR NYA BILDER SLUTAR LADDA: CM har lagt dem i en NY bucket — proba en högre bucket
 * med curl (`-e https://www.cardmarket.com/`) och lägg till den i CM_IMAGE_SHARDS.
 *
 * VIKTIGT: att Cardmarket-KATALOGEN har en bild-URL för en produkt betyder INTE att
 * CM har en egen render av den. Hundratals sealed-SKU:er (särskilt blistrar,
 * checklanes och pin-collections) saknar render helt. Använd `cmRenderExists()` innan
 * du pekar en produkts imageUrl på proxyn — annars blir bilden trasig i katalogen.
 */
export const CM_IMAGE_SHARDS = [
  53, 52, 54, 1014, 1015, 1016, 1017, 1018, 51, 55, 50, 56, 57, 58,
];
const EXTS = ["png", "jpg"] as const;

const REFERER = "https://www.cardmarket.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const CM_IMAGE_HEADERS = { referer: REFERER, "user-agent": UA };

/** Alla tänkbara CDN-URL:er för ett idProduct, i sannolikhetsordning. */
export function cmImageCandidates(idProduct: string | number): string[] {
  const urls: string[] = [];
  for (const shard of CM_IMAGE_SHARDS)
    for (const ext of EXTS)
      urls.push(
        `https://product-images.s3.cardmarket.com/${shard}/${idProduct}/${idProduct}.${ext}`
      );
  return urls;
}

/** Proxy-URL:en vi lagrar i Product.imageUrl (serveras av /api/cm-image/[idProduct]). */
export const cmImageProxyUrl = (idProduct: string | number) => `/api/cm-image/${idProduct}`;

/** Finns det en render hos Cardmarket? HEAD-probar de kända bucketarna. */
export async function cmRenderExists(idProduct: string | number): Promise<boolean> {
  for (const url of cmImageCandidates(idProduct)) {
    try {
      const res = await fetch(url, { method: "HEAD", headers: CM_IMAGE_HEADERS });
      if (res.ok) return true;
    } catch {
      // nätverksfel på en kandidat → prova nästa
    }
  }
  return false;
}
