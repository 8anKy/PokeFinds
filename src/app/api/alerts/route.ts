import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listAlerts } from "@/services/alerts";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { page, pageSize } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const result = await listAlerts(user.id, { page, pageSize });
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
