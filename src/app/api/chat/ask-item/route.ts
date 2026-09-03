import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import {
  allowsPurchaseRequests,
  ASK_DEDUPE_MS,
  ASKS_PER_HOUR,
  purchaseAskText,
} from "@/lib/purchase-requests";
import { getOrCreateConversation, sendMessage } from "@/services/chat";

export const dynamic = "force-dynamic";

const schema = z.object({
  ownerId: z.string().min(1).max(64),
  /** Ett CollectionItem-id ur ägarens samling (rutans första post). */
  itemId: z.string().min(1).max(64),
});

/**
 * "Är den till salu?" från en annan persons Portfölj-flik: öppnar (eller
 * återanvänder) parets chatt och skickar EN automatisk fråga om objektet. Push
 * sköter sendMessage när mottagaren inte är ansluten. Samma fråga om samma
 * objekt inom ett dygn skickas inte igen — då öppnas bara chatten (`sent:false`).
 *
 * Vakter, i ordning: konto + grind → inte sig själv → ägaren finns, samlingen är
 * offentlig och tar emot frågor → objektet är ägarens → tak per timme →
 * chattens egna regler (blockering, nya samtal/dygn, sändningar/min).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const input = schema.parse(await req.json());
    if (input.ownerId === user.id) throw new ServiceError(400, "Det är din egen samling.");

    const owner = await prisma.user.findUnique({
      where: { id: input.ownerId },
      select: { id: true, isPublicCollection: true, preferences: true },
    });
    if (!owner) throw new ServiceError(404, "Användaren hittades inte.");
    if (!owner.isPublicCollection) throw new ServiceError(403, "Samlingen är inte offentlig.");
    if (!allowsPurchaseRequests(owner.preferences)) {
      throw new ServiceError(403, "Ägaren tar inte emot köpförfrågningar.");
    }

    const item = await prisma.collectionItem.findFirst({
      where: { id: input.itemId, userId: owner.id },
      select: {
        notes: true,
        card: { select: { name: true, set: { select: { name: true } } } },
        product: { select: { title: true } },
      },
    });
    if (!item) throw new ServiceError(404, "Objektet finns inte i samlingen.");

    const limit = await rateLimit(`ask-item:${user.id}`, ASKS_PER_HOUR, 60 * 60 * 1000);
    if (!limit.ok) {
      throw new ServiceError(429, "Du har skickat många köpförfrågningar. Vänta en stund.");
    }

    const name = item.card?.name ?? item.product?.title ?? item.notes ?? "objektet";
    const text = purchaseAskText(name, item.card?.set?.name ?? null);

    const { id: conversationId } = await getOrCreateConversation(user.id, owner.id);
    const duplicate = await prisma.message.findFirst({
      where: {
        conversationId,
        senderId: user.id,
        body: text,
        createdAt: { gte: new Date(Date.now() - ASK_DEDUPE_MS) },
      },
      select: { id: true },
    });
    if (duplicate) return jsonOk({ conversationId, sent: false });

    await sendMessage(conversationId, { id: user.id, name: user.name }, text);
    return jsonOk({ conversationId, sent: true });
  } catch (e) {
    return apiError(e);
  }
}
