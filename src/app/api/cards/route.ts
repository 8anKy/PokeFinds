import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonCached } from "@/lib/api";

const querySchema = z.object({
  query: z.string().trim().max(200).optional(),
  setId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export async function GET(req: NextRequest) {
  try {
    const { query, setId, page, pageSize } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const where = {
      ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
      ...(setId ? { setId } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.card.findMany({
        where,
        include: { set: { select: { id: true, name: true, series: true } } },
        orderBy: [{ name: "asc" }, { number: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.card.count({ where }),
    ]);

    return jsonCached(
      {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      600
    );
  } catch (e) {
    return apiError(e);
  }
}
