import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { effectivePlanTier } from "@/lib/plan";
import {
  addWatchlistItem,
  listWatchlist,
  listWatchedProductIds,
  removeWatchlistItemByProduct,
} from "@/services/watchlist";
import { trackEvent } from "@/services/analytics";
import { AlertChannel } from "@prisma/client";

export const dynamic = "force-dynamic";

const addSchema = z.object({
  productId: z.string().min(1),
  targetPrice: z.number().int().min(0).optional(), // öre
  maxPrice: z.number().int().min(0).optional(), // öre
  restockAlert: z.boolean().optional(),
  priceAlert: z.boolean().optional(),
  channels: z.array(z.nativeEnum(AlertChannel)).optional(),
});

/**
 * `?ids=1` → bara produkt-id:na. Klockan i produktkortet behöver veta om DENNA
 * produkt bevakas och inget mer; hela listan (bild, set, offers, lägsta pris)
 * vore ren egress för data som aldrig ritas — och den läses av var 20-40:e kort
 * i ett rutnät. Samma uppdelning som /api/set-watch.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (new URL(req.url).searchParams.get("ids") === "1") {
      return jsonOk({ productIds: await listWatchedProductIds(user.id) });
    }
    const items = await listWatchlist(user.id);
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * `DELETE /api/watchlist?productId=…` — ta bort nycklat på PRODUKT.
 *
 * Ligger på samlings-rutten och inte under `[id]` med flit: anroparen (klockan)
 * har produkten, inte bevakningsradens id. Radvägen (`/api/watchlist/[id]`) finns
 * kvar oförändrad för bevakningslistan, som HAR id:t.
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const productId = new URL(req.url).searchParams.get("productId");
    if (!productId) return apiError(new ServiceError(400, "productId saknas."));
    const result = await removeWatchlistItemByProduct(user.id, productId);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const input = addSchema.parse(await req.json());
    const item = await addWatchlistItem(user.id, effectivePlanTier(user), input);
    await trackEvent("watchlist_add", input.productId);
    return jsonOk(item, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
