import { apiError, jsonCached } from "@/lib/api";
import { ServiceError } from "@/lib/errors";
import { loadProductDetail } from "@/services/products";

/**
 * Hela produktsidans data för produkt-overlayn (klient-sida). Backas av de
 * cachade loaders (`loadProductDetail`) → upprepade öppningar träffar cachen,
 * inte Neon. CDN-cachas dessutom (publik, opersonlig data).
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const data = await loadProductDetail(params.slug);
    if (!data) throw new ServiceError(404, "Produkten hittades inte.");
    return jsonCached(data, 600);
  } catch (e) {
    return apiError(e);
  }
}
