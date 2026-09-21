import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { PORTFOLIO_NAME_MAX } from "@/lib/portfolio-limit";
import { deletePortfolio, updatePortfolio } from "@/services/portfolios";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    name: z.string().min(1).max(PORTFOLIO_NAME_MAX).optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.isPublic !== undefined, { message: "Tom förfrågan." });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const input = updateSchema.parse(await req.json());
    return jsonOk(await updatePortfolio(user.id, params.id, input));
  } catch (e) {
    return apiError(e);
  }
}

/** Posterna följer INTE med i graven — de faller tillbaka i standardpärmen (FK SetNull). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    return jsonOk(await deletePortfolio(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
