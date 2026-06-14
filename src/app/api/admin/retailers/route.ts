import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeAuditLog } from "@/services/analytics";
import { SourceType } from "@prisma/client";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  websiteUrl: z.string().url("Ogiltig URL."),
  logoUrl: z.string().url().optional(),
  country: z.string().length(2).default("SE"),
  isActive: z.boolean().default(true),
  sourceType: z.nativeEnum(SourceType).default("MANUAL"),
  affiliateEnabled: z.boolean().default(false),
  affiliateParams: z.string().max(500).optional(),
});

export async function GET() {
  try {
    await requireRole("ADMIN");
    const retailers = await prisma.retailer.findMany({
      include: { _count: { select: { offers: true } } },
      orderBy: { name: "asc" },
    });
    return jsonOk({ items: retailers });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const input = createSchema.parse(await req.json());

    const retailer = await prisma.retailer.create({ data: input });

    await writeAuditLog({
      userId: admin.id,
      action: "retailer.create",
      entityType: "Retailer",
      entityId: retailer.id,
      metadata: { name: retailer.name },
    });

    return jsonOk(retailer, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
