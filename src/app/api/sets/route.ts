import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonCached } from "@/lib/api";

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
        // nulls: "last" — Postgres lägger NULL FÖRST vid DESC, så ett set utan
        // releaseDate (ett kommande set vi skapat ur CM:s episodlista innan
        // pokemontcg.io har det) låg överst som om det vore det allra nyaste.
        // Samma fälla som setfiltret på /produkter redan gått i.
        orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cardSet.count({ where }),
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
