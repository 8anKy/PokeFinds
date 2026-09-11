/**
 * POST /api/cron/feed-inbox — tar emot dagens utkast till nyhetsinkorgen.
 *
 * Anroparen är `news-feed.yml` (DB-fritt), som läser `.github/feed/inbox.json` ur
 * repot — filen den dagliga AI-rutinen pushar — och skickar utkasten hit. Rutten
 * slår ihop dem med `drafts.json` på volymen (`mergeInbox`): nya id:n blir
 * väntande, avgjorda rader rörs aldrig. Se `src/lib/feed-inbox.ts`.
 *
 * ⛔ INGEN DATABAS HÄR — samma villkor som `feed-publish`. Lägg aldrig till en
 *    `prisma`-import i den här filen.
 * ⛔ Rutten PUBLICERAR INGENTING: ett utkast når flödet först när ägaren godkänner
 *    det i admin (`/api/admin/feed-inbox/[id]`).
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { inboxPublishSchema, mergeInbox } from "@/lib/feed-inbox";
import { readInbox, writeInbox } from "@/lib/feed-inbox-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error("[feed-inbox] CRON_SECRET saknas i miljön — rutten är avstängd.");
      return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    }
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }

    const payload = inboxPublishSchema.parse(await req.json());
    const current = await readInbox();
    const doc = mergeInbox(current, payload);
    const pending = doc.items.filter((i) => i.status === "pending").length;
    const added = Math.max(0, doc.items.length - current.items.length);

    if (doc.updatedAt !== current.updatedAt) await writeInbox(doc);

    console.log(`[feed-inbox] ${payload.drafts.length} utkast levererade, ${added} nya ⇒ ${pending} väntar på beslut.`);
    return jsonOk({ ok: true, delivered: payload.drafts.length, added, pending });
  } catch (error) {
    return apiError(error);
  }
}
