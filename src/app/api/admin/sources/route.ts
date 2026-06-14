import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeAuditLog } from "@/services/analytics";
import { SourceType } from "@prisma/client";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().url("Ogiltig URL."),
  type: z.nativeEnum(SourceType).default("MOCK"),
  isActive: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

export async function GET() {
  try {
    await requireRole("ADMIN");
    const sources = await prisma.scrapeSource.findMany({
      include: {
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { jobs: true } },
      },
      orderBy: { name: "asc" },
    });
    return jsonOk({ items: sources });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const input = createSchema.parse(await req.json());

    const source = await prisma.scrapeSource.create({
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        type: input.type,
        isActive: input.isActive,
        config: input.config as never,
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "scrapeSource.create",
      entityType: "ScrapeSource",
      entityId: source.id,
      metadata: { name: source.name },
    });

    return jsonOk(source, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
