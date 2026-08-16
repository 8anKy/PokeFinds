import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getSetCompletion } from "@/services/set-completion";

// Personligt svar → aldrig cachat. Syskonrutten (`../route.ts`) är publik och
// `jsonCached`; den här får INTE bli det, den innehåller EN användares samling.
export const dynamic = "force-dynamic";

/**
 * `{ total, ownedCount, ownedCardIds }` för ETT set.
 *
 * Ogrindad utöver inloggning: setkomplettering är ingen Pro-förmån, och svaret
 * går bara till den som frågar om sin egen samling. Anropas EN gång per
 * sidvisning via `src/lib/set-completion.ts` — se kommentaren där.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    return jsonOk(await getSetCompletion(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
