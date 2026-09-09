/**
 * POST /api/cron/feed-publish — nyhets- och evenemangsflödet (se src/lib/feed.ts).
 *
 * Skyddas av x-cron-secret = CRON_SECRET, som de andra cron-rutterna. Anroparen är
 * GitHub-jobbet `news-feed.yml`, som kör HELT UTAN databas: det hämtar RSS, bygger
 * dokumentet och skickar det hit. Rutten skriver filen till Railway-volymen och
 * invaliderar sidornas cache.
 *
 * ⛔ INGEN DATABAS HÄR. Det är hela poängen — flödet får kosta noll vaken tid i
 *    Neon, både när det publiceras och när det läses. Lägg aldrig till en
 *    `prisma`-import i den här filen.
 * ⛔ EN LANE ERSÄTTS ÅT GÅNGEN, HELT. Två jobb fyller flödet: `rss` (DB-fritt,
 *    flera gånger om dagen) och `foilio` (vår egen katalog, ett steg i nattkedjan).
 *    Varje jobb bygger SIN lista från grunden varje gång, så inom lanen skrivs
 *    allt över — annars hade borttagna poster legat kvar för evigt. Men det som
 *    kom från den ANDRA lanen behålls: utan den regeln hade det jobb som körde
 *    sist raderat det andras nyheter.
 * ⛔ `events` skickas bara av den lane som äger dem. Utelämnas fältet (`null`)
 *    lämnas evenemangen orörda — ett jobb som inte har något att säga om dem ska
 *    inte kunna tömma listan.
 */
import { type NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { apiError, jsonOk } from "@/lib/api";
import { feedPublishSchema, normalizeFeed } from "@/lib/feed";
import { FEED_CACHE_TAG, readFeed, writeFeed } from "@/lib/feed-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error("[feed-publish] CRON_SECRET saknas i miljön — rutten är avstängd.");
      return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    }
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }

    const payload = feedPublishSchema.parse(await req.json());
    const current = await readFeed();

    const doc = normalizeFeed({
      generatedAt: payload.generatedAt,
      news: [...current.news.filter((n) => n.lane !== payload.lane), ...payload.news],
      events: payload.events ?? current.events,
    });

    await writeFeed(doc);
    revalidateTag(FEED_CACHE_TAG);

    console.log(
      `[feed-publish] lane ${payload.lane}: +${payload.news.length} nyheter ⇒ ${doc.news.length} totalt, ` +
        `${doc.events.length} evenemang (byggt ${payload.generatedAt}).`
    );
    return jsonOk({ ok: true, lane: payload.lane, news: doc.news.length, events: doc.events.length });
  } catch (error) {
    return apiError(error);
  }
}
