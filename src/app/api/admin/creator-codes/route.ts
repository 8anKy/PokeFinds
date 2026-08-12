import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { normalizeCreatorCode, CREATOR_CODE_MAX_LENGTH } from "@/lib/creator-ref";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().trim().min(2).max(CREATOR_CODE_MAX_LENGTH),
  creatorName: z.string().trim().min(1).max(120),
  channel: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
  // Stripes promotion_code-ID (promo_…), INTE den läsbara koden. Hämtas i Stripe:
  // Produkter → Kuponger → din kupong → koden → ID uppe till höger.
  stripePromotionCodeId: z
    .string()
    .trim()
    .regex(/^promo_[A-Za-z0-9]+$/, "Ska vara Stripes promotion_code-ID (promo_…).")
    .optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
  stripePromotionCodeId: z
    .string()
    .trim()
    .regex(/^promo_[A-Za-z0-9]+$/, "Ska vara Stripes promotion_code-ID (promo_…).")
    .nullable()
    .optional(),
});

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const input = createSchema.parse(await req.json());

    // Kanonisk form innan unikhetskollen — annars blir "emma" och "EMMA" två rader
    // och `?ref=emma` träffar fel (eller ingen) kreatör.
    const code = normalizeCreatorCode(input.code);
    if (!code) {
      throw new ServiceError(400, "Koden får bara innehålla A–Ö, 0–9, bindestreck och understreck.");
    }

    const existing = await prisma.creatorCode.findUnique({ where: { code } });
    if (existing) {
      throw new ServiceError(409, `Koden ${code} används redan av ${existing.creatorName}.`);
    }

    const created = await prisma.creatorCode.create({
      data: {
        code,
        creatorName: input.creatorName,
        channel: input.channel || null,
        note: input.note || null,
        stripePromotionCodeId: input.stripePromotionCodeId || null,
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "creatorCode.create",
      entityType: "CreatorCode",
      entityId: created.id,
      metadata: { code: created.code, creatorName: created.creatorName },
    });

    return jsonOk(created, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const { id, ...changes } = patchSchema.parse(await req.json());

    // ⛔ Koden själv går INTE att byta. Den står i publicerade videor och länkar
    // som lever kvar för alltid; ett byte hade tyst gjort all gammal trafik
    // oattribuerad. Behövs en ny kod skapas en ny rad.
    const updated = await prisma.creatorCode.update({
      where: { id },
      data: {
        ...(changes.isActive === undefined ? {} : { isActive: changes.isActive }),
        ...(changes.stripePromotionCodeId === undefined
          ? {}
          : { stripePromotionCodeId: changes.stripePromotionCodeId }),
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "creatorCode.update",
      entityType: "CreatorCode",
      entityId: updated.id,
      metadata: { code: updated.code, isActive: updated.isActive },
    });

    return jsonOk(updated);
  } catch (e) {
    return apiError(e);
  }
}
