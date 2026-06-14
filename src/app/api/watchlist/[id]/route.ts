import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { removeWatchlistItem, updateWatchlistItem } from "@/services/watchlist";
import { AlertChannel } from "@prisma/client";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  targetPrice: z.number().int().min(0).nullable().optional(), // öre
  maxPrice: z.number().int().min(0).nullable().optional(), // öre
  restockAlert: z.boolean().optional(),
  priceAlert: z.boolean().optional(),
  isPaused: z.boolean().optional(),
  channels: z.array(z.nativeEnum(AlertChannel)).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const input = updateSchema.parse(await req.json());
    const item = await updateWatchlistItem(user.id, params.id, input);
    return jsonOk(item);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const result = await removeWatchlistItem(user.id, params.id);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
