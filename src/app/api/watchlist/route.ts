import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { effectivePlanTier } from "@/lib/plan";
import { addWatchlistItem, listWatchlist } from "@/services/watchlist";
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

export async function GET() {
  try {
    const user = await requireUser();
    const items = await listWatchlist(user.id);
    return jsonOk({ items });
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
