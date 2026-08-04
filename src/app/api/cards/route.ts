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
        // ⛔ `select`, ALDRIG `include` (2026-08-05). `include` hämtade hela Card-raden,
        // inklusive skannerns binärkolumner `artFingerprint` (264 B) och
        // `structFingerprint` (959 B) — och `NextResponse.json` serialiserar en Buffer
        // som `{"type":"Buffer","data":[…]}`, dvs ~1,2 kB rådata blir FLERA kB JSON.
        // Per kort. Med `pageSize` upp till 100 blev en sökträfflista på fyra fält
        // hundratals kB. Enda anroparen (samlingens snabbsök) läser id/name/number/
        // set.name; de övriga fälten nedan är billiga och behålls för det publika
        // API-kontraktet (docs/API.md).
        select: {
          id: true,
          name: true,
          number: true,
          rarity: true,
          imageUrl: true,
          language: true,
          setId: true,
          set: { select: { id: true, name: true, series: true } },
        },
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
