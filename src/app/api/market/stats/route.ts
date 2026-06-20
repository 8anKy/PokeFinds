import { apiError, jsonCached } from "@/lib/api";
import { getMarketStats, getSetIndex } from "@/services/market";

export async function GET() {
  try {
    const [stats, setIndex] = await Promise.all([getMarketStats(), getSetIndex()]);
    return jsonCached({ ...stats, setIndex }, 300);
  } catch (e) {
    return apiError(e);
  }
}
