import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.nativeEnum(JobStatus).optional(),
  sourceId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const { status, sourceId, page, pageSize } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const where = {
      ...(status ? { status } : {}),
      ...(sourceId ? { sourceId } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.scrapeJob.findMany({
        where,
        include: {
          source: { select: { id: true, name: true, type: true, baseUrl: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.scrapeJob.count({ where }),
    ]);

    return jsonOk({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    return apiError(e);
  }
}
