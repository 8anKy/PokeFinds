import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { importCollectionRows } from "@/services/collection";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  rows: z
    .array(z.record(z.unknown()))
    .min(1, "Minst en rad krävs.")
    .max(1000, "Max 1000 rader per import."),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { rows } = bodySchema.parse(await req.json());
    const result = await importCollectionRows(user.id, rows);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
