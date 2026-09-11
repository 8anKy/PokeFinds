/**
 * POST /api/admin/feed-inbox/events/[id] — ägarens beslut om ett EVENEMANGSUTKAST.
 * Samma fyra åtgärder som nyheterna (`../[id]/route.ts`); godkänt ⇒ lane `curated`
 * bland evenemangen, som rss-jobbet aldrig skriver över. Ingen databas.
 */
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { approveEventInputSchema, draftToEventItem } from "@/lib/feed-inbox";
import { updateInbox } from "@/lib/feed-inbox-store";
import { FEED_CACHE_TAG, removeEventById, upsertCuratedEvent } from "@/lib/feed-store";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), item: approveEventInputSchema }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("unpublish") }),
  z.object({ action: z.literal("restore") }),
]);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    const body = bodySchema.parse(await req.json());
    const id = params.id;
    const now = new Date().toISOString();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

    let found = false;
    const doc = await updateInbox(async (inbox) => {
      const entry = inbox.events.find((i) => i.id === id);
      if (!entry) return inbox;
      found = true;

      if (body.action === "approve") {
        await upsertCuratedEvent(draftToEventItem(entry, body.item, baseUrl));
        Object.assign(entry, body.item, { status: "approved", decidedAt: now });
      } else if (body.action === "reject") {
        entry.status = "rejected";
        entry.decidedAt = now;
      } else if (body.action === "unpublish") {
        await removeEventById(id);
        entry.status = "pending";
        entry.decidedAt = null;
      } else {
        entry.status = "pending";
        entry.decidedAt = null;
      }
      return { ...inbox, updatedAt: now };
    });

    if (!found) return jsonOk({ error: "Evenemanget finns inte längre i inkorgen." }, { status: 404 });
    if (body.action === "approve" || body.action === "unpublish") revalidateTag(FEED_CACHE_TAG);

    return jsonOk({ ok: true, item: doc.events.find((i) => i.id === id) ?? null });
  } catch (e) {
    return apiError(e);
  }
}
