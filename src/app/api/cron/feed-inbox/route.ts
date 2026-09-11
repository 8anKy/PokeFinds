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
import { updateInbox } from "@/lib/feed-inbox-store";

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
    let added = 0;
    let addedEvents = 0;
    // ⛔ Via updateInbox: en oläsbar fil ger 500 här i stället för att skrivas över med en tom.
    const doc = await updateInbox((current) => {
      const merged = mergeInbox(current, payload);
      added = Math.max(0, merged.items.length - current.items.length);
      addedEvents = Math.max(0, merged.events.length - current.events.length);
      return merged.updatedAt === current.updatedAt ? current : merged;
    });
    const pending = doc.items.filter((i) => i.status === "pending").length;
    const pendingEvents = doc.events.filter((i) => i.status === "pending").length;

    console.log(
      `[feed-inbox] ${payload.drafts.length} nyhetsutkast (${added} nya) + ${payload.events.length} evenemangsutkast (${addedEvents} nya) levererade ⇒ ` +
        `${pending} nyheter och ${pendingEvents} evenemang väntar på beslut.`
    );
    return jsonOk({ ok: true, delivered: payload.drafts.length, added, pending, deliveredEvents: payload.events.length, addedEvents, pendingEvents });
  } catch (error) {
    return apiError(error);
  }
}
