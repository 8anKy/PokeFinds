import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ReportStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.nativeEnum(ReportStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole("MODERATOR");
    const { status, page, pageSize } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const where = status ? { status } : {};

    const [items, total] = await prisma.$transaction([
      prisma.report.findMany({
        where,
        include: {
          post: {
            select: {
              id: true,
              title: true,
              isHidden: true,
              user: { select: { id: true, name: true } },
            },
          },
          reporter: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.report.count({ where }),
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
