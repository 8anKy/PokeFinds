import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { getRecentRestocks } from "@/services/market";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const { limit } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const items = await getRecentRestocks(limit);
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}
