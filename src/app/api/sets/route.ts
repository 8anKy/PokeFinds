import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: NextRequest) {
  try {
    const { query, page, pageSize } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const where = query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { series: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [items, total] = await prisma.$transaction([
      prisma.cardSet.findMany({
        where,
        include: { _count: { select: { products: true, cards: true } } },
        orderBy: { releaseDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cardSet.count({ where }),
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
