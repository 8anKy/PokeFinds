import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { SourceType } from "@prisma/client";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  websiteUrl: z.string().url("Ogiltig URL.").optional(),
  logoUrl: z.string().url().nullable().optional(),
  country: z.string().length(2).optional(),
  isActive: z.boolean().optional(),
  sourceType: z.nativeEnum(SourceType).optional(),
  affiliateEnabled: z.boolean().optional(),
  affiliateParams: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("ADMIN");
    const input = updateSchema.parse(await req.json());

    const retailer = await prisma.retailer.findUnique({ where: { id: params.id } });
    if (!retailer) throw new ServiceError(404, "Återförsäljaren hittades inte.");

    const updated = await prisma.retailer.update({
      where: { id: params.id },
      data: input,
    });

    await writeAuditLog({
      userId: admin.id,
      action: "retailer.update",
      entityType: "Retailer",
      entityId: params.id,
      metadata: { changes: input },
    });

    return jsonOk(updated);
  } catch (e) {
    return apiError(e);
  }
}
