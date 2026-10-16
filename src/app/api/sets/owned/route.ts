import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getOwnedBySet } from "@/services/sets-gallery";

// Personligt svar → aldrig cachat (samma skäl som `../[id]/completion`).
export const dynamic = "force-dynamic";

/**
 * `{ [setId]: { owned, valueOre } }` för den inloggade — /sets-rutornas stapel och
 * "Ditt värde". Anropas EN gång per sidvisning, bara när fo_auth-hinten säger inloggad.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await getOwnedBySet(user.id));
  } catch (e) {
    return apiError(e);
  }
}
