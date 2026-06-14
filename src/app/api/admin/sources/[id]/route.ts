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
  baseUrl: z.string().url("Ogiltig URL.").optional(),
  type: z.nativeEnum(SourceType).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("ADMIN");
    const input = updateSchema.parse(await req.json());

    const source = await prisma.scrapeSource.findUnique({ where: { id: params.id } });
    if (!source) throw new ServiceError(404, "Källan hittades inte.");

    const updated = await prisma.scrapeSource.update({
      where: { id: params.id },
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        type: input.type,
        isActive: input.isActive,
        ...(input.config !== undefined ? { config: input.config as never } : {}),
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "scrapeSource.update",
      entityType: "ScrapeSource",
      entityId: params.id,
      metadata: { changes: input },
    });

    return jsonOk(updated);
  } catch (e) {
    return apiError(e);
  }
}
