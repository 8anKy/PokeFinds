import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { removeCollectionItem, updateCollectionItem } from "@/services/collection";
import { CardCondition, CardLanguage } from "@prisma/client";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  quantity: z.number().int().min(1).max(10000).optional(),
  condition: z.nativeEnum(CardCondition).optional(),
  language: z.nativeEnum(CardLanguage).optional(),
  purchasePrice: z.number().int().min(0).optional(), // öre
  purchaseDate: z.coerce.date().optional(),
  estimatedValue: z.number().int().min(0).optional(), // öre
  gradingCompany: z.string().max(50).optional(),
  grade: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const input = updateSchema.parse(await req.json());
    const item = await updateCollectionItem(user.id, params.id, input);
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
    const result = await removeCollectionItem(user.id, params.id);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
