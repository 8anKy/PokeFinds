import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { hasRole, requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { PlanTier, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  role: z.nativeEnum(Role).optional(), // kräver SUPERADMIN
  planTier: z.nativeEnum(PlanTier).optional(),
  isPublicCollection: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("ADMIN");
    const input = updateSchema.parse(await req.json());

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true },
    });
    if (!target) throw new ServiceError(404, "Användaren hittades inte.");

    // Rolländringar kräver SUPERADMIN
    if (input.role !== undefined && input.role !== target.role) {
      if (!hasRole(admin.role, "SUPERADMIN")) {
        throw new ServiceError(403, "Endast superadmin kan ändra roller.");
      }
      if (target.id === admin.id) {
        throw new ServiceError(400, "Du kan inte ändra din egen roll.");
      }
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: input,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        planTier: true,
        isPublicCollection: true,
        onboardingCompleted: true,
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "user.update",
      entityType: "User",
      entityId: params.id,
      metadata: { changes: input },
    });

    return jsonOk(updated);
  } catch (e) {
    return apiError(e);
  }
}
