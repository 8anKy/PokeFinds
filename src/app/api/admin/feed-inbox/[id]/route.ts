/**
 * POST /api/admin/feed-inbox/[id] — ägarens beslut om ett utkast.
 *
 *   { action: "approve", item: {...} }  rättade fält ⇒ posten läggs i lane `curated`
 *   { action: "reject" }                göms; kommer aldrig tillbaka (rutinen minns själv)
 *   { action: "unpublish" }             ångra: bort ur flödet, tillbaka till väntande
 *   { action: "restore" }               ett avvisat utkast tillbaka till väntande
 *
 * ⛔ Godkännandet går via `upsertCuratedNews`, aldrig via `feed-publish`: den rutten
 *    ersätter en hel lane och de godkända posterna finns ingen annanstans.
 * ⛔ Ingen databas — inkorg och flöde är filer på volymen.
 */
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { approveInputSchema, draftToNewsItem } from "@/lib/feed-inbox";
import { updateInbox } from "@/lib/feed-inbox-store";
import { FEED_CACHE_TAG, removeNewsById, upsertCuratedNews } from "@/lib/feed-store";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), item: approveInputSchema }),
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

    let found = false;
    const doc = await updateInbox(async (inbox) => {
      const entry = inbox.items.find((i) => i.id === id);
      if (!entry) return inbox;
      found = true;

      if (body.action === "approve") {
        await upsertCuratedNews(draftToNewsItem(entry, body.item));
        // Rättningarna sparas på raden också, så admin visar det som faktiskt publicerades.
        Object.assign(entry, body.item, { status: "approved", decidedAt: now });
      } else if (body.action === "reject") {
        entry.status = "rejected";
        entry.decidedAt = now;
      } else if (body.action === "unpublish") {
        await removeNewsById(id);
        entry.status = "pending";
        entry.decidedAt = null;
      } else {
        entry.status = "pending";
        entry.decidedAt = null;
      }
      return { ...inbox, updatedAt: now };
    });

    if (!found) return jsonOk({ error: "Utkastet finns inte längre." }, { status: 404 });
    if (body.action === "approve" || body.action === "unpublish") revalidateTag(FEED_CACHE_TAG);

    return jsonOk({ ok: true, item: doc.items.find((i) => i.id === id) ?? null });
  } catch (e) {
    return apiError(e);
  }
}
