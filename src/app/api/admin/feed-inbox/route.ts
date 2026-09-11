/**
 * GET /api/admin/feed-inbox — nyhetsinkorgen som admin ser den. Läser bara
 * volymfilen (`drafts.json`); ingen databas.
 */
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readInbox } from "@/lib/feed-inbox-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMIN");
    return jsonOk(await readInbox());
  } catch (e) {
    return apiError(e);
  }
}
