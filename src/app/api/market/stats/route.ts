import { apiError, jsonOk } from "@/lib/api";
import { getMarketStats, getSetIndex } from "@/services/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, setIndex] = await Promise.all([getMarketStats(), getSetIndex()]);
    return jsonOk({ ...stats, setIndex });
  } catch (e) {
    return apiError(e);
  }
}
