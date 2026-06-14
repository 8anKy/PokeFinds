import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { computeCollectionValue } from "@/services/collection";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const value = await computeCollectionValue(user.id);
    return jsonOk(value);
  } catch (e) {
    return apiError(e);
  }
}
