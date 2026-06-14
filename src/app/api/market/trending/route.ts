import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { getTrending } from "@/services/market";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: NextRequest) {
  try {
    const { limit } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const items = await getTrending(limit);
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}
