import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { recordActivity, withStreak } from "@/services/streak";
import { effectivePlanTier } from "@/lib/plan";
import { requireEntitledUser, requireUser } from "@/lib/auth";
import { addCollectionItem, listCollection } from "@/services/collection";
import { markScanAdded } from "@/services/giveaway";
import { CardCondition, CardLanguage } from "@prisma/client";

export const dynamic = "force-dynamic";

const collectionItemSchema = z
  .object({
    cardId: z.string().min(1).optional(),
    productId: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(10000).default(1),
    condition: z.nativeEnum(CardCondition).optional(),
    language: z.nativeEnum(CardLanguage).optional(),
    purchasePrice: z.number().int().min(0).optional(), // öre
    purchaseDate: z.coerce.date().optional(),
    estimatedValue: z.number().int().min(0).optional(), // öre
    gradingCompany: z.string().max(50).optional(),
    grade: z.string().max(20).optional(),
    notes: z.string().max(1000).optional(),
    imageUrl: z.string().url().optional(),
    /** Pärm att lägga posten i. Utelämnad = standardpärmen. */
    portfolioId: z.string().min(1).optional(),
    /** Skanningen kortet kom ur (skannern skickar den) — giveawayns "skanna = 1 lott". */
    scanJobId: z.string().min(1).max(64).optional(),
  })
  .refine((d) => d.cardId || d.productId || d.notes, {
    message: "Ange kort, produkt eller en anteckning.",
  });

export async function GET() {
  try {
    const user = await requireUser();
    const items = await listCollection(user.id);
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireEntitledUser();
    const { scanJobId, ...input } = collectionItemSchema.parse(await req.json());
    const item = await addCollectionItem(user.id, input);
    // Bokföringen får aldrig fälla tillägget — kortet ÄR redan i samlingen.
    const cardId = item.cardId;
    if (scanJobId && cardId) {
      await markScanAdded(user.id, scanJobId, cardId).catch((e) =>
        console.error("[giveaway] kunde inte bokföra skanningen:", e)
      );
    }
    const streak = await recordActivity(user.id, effectivePlanTier(user));
    return withStreak(jsonOk(item, { status: 201 }), streak);
  } catch (e) {
    return apiError(e);
  }
}
