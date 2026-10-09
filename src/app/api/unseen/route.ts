import { apiError, jsonOk } from "@/lib/api";
import { communityV2Request } from "@/lib/community-v2-server";
import { newsFeedPublic } from "@/lib/news-feed-gate";
import { readSessionLite } from "@/lib/session-lite";
import { getFeed as getNewsFeed } from "@/lib/feed-store";
import { latestByOthers, latestPublished } from "@/lib/unseen";
import { getCommunityLatest } from "@/services/community";

export const dynamic = "force-dynamic";

/**
 * Senaste tidsstämpeln i Community och Nyheter — klienten jämför mot när enheten
 * senast öppnade sektionen och tänder pricken (lib/unseen.ts).
 *
 * ⛔ Väcker inte Neon per anrop: sessionen läses ur cookien (`readSessionLite`, ingen
 *    jwt-callback), Community ur en delad cache som bara kastas av skrivningar, och
 *    Nyheter är en fil på volymen. Klienten frågar vid appstart/återkomst, aldrig på timer.
 */
export async function GET() {
  try {
    const session = await readSessionLite();
    const [community, news] = await Promise.all([
      (async () => {
        if (!(await communityV2Request(session?.role ?? null))) return null;
        return latestByOthers(await getCommunityLatest(), session?.id ?? null);
      })(),
      (async () => (newsFeedPublic() ? latestPublished((await getNewsFeed()).news) : null))(),
    ]);
    return jsonOk({ community, news }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
