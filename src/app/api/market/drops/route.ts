import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonCached } from "@/lib/api";
import { getTopDrops } from "@/services/market";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: NextRequest) {
  try {
    const { limit } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const items = await getTopDrops(limit);
    return jsonCached({ items }, 300);
  } catch (e) {
    return apiError(e);
  }
}
