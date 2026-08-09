import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { readJsonCapped } from "@/lib/body-limit";
import { importCollectionRows } from "@/services/collection";

export const dynamic = "force-dynamic";

/** Hårt body-tak, verkställs INNAN kroppen buffras (1000 rader ryms med marginal). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const bodySchema = z.object({
  rows: z
    .array(z.record(z.unknown()))
    .min(1, "Minst en rad krävs.")
    .max(1000, "Max 1000 rader per import."),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { rows } = bodySchema.parse(await readJsonCapped(req, MAX_BODY_BYTES));
    const result = await importCollectionRows(user.id, rows);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
