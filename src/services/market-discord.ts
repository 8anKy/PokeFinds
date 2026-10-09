/**
 * EN väg från en köp/sälj/byt-annons till Discords köp-trade-sälj-kanal: läs annonsen
 * färskt, hämta ALLA foton ur bucketen och posta dem som bilagor, spara meddelande-id:t
 * så spegeln kan tas bort med annonsen (lib/discord-market.ts).
 *
 * ⛔ Kastar aldrig — anropas fire-and-forget efter att annonsen är sparad.
 */
import { prisma } from "@/lib/db";
import { getObjectBytes, sniffImageType } from "@/lib/object-storage";
import {
  deleteMarketPostsFromDiscord,
  discordMarketConfig,
  MAX_MARKET_PHOTOS,
  postMarketThreadToDiscord,
  type MarketPhoto,
} from "@/lib/discord-market";

async function loadPhotos(keys: string[]): Promise<MarketPhoto[]> {
  const photos = await Promise.all(
    keys.slice(0, MAX_MARKET_PHOTOS).map(async (key) => {
      const bytes = await getObjectBytes(key).catch(() => null);
      const contentType = bytes ? sniffImageType(bytes) : null;
      return bytes && contentType ? { bytes, contentType } : null;
    })
  );
  return photos.filter((p): p is MarketPhoto => p !== null);
}

/** En AKTIV, synlig annons i marknadsgruppen som inte redan speglats. */
async function loadListing(postId: string) {
  return prisma.communityPost.findFirst({
    where: {
      id: postId,
      isHidden: false,
      listingStatus: "ACTIVE",
      discordMessageId: null,
      group: { isMarketplace: true },
    },
    select: {
      id: true,
      title: true,
      content: true,
      listingKind: true,
      priceOre: true,
      condition: true,
      user: { select: { name: true } },
      product: { select: { slug: true } },
      images: { orderBy: { sortOrder: "asc" }, select: { key: true } },
    },
  });
}

export async function syncMarketPostToDiscord(postId: string): Promise<void> {
  try {
    if (!discordMarketConfig()) return;
    const post = await loadListing(postId);
    if (!post) return;
    const messageId = await postMarketThreadToDiscord(
      {
        id: post.id,
        title: post.title,
        content: post.content,
        listingKind: post.listingKind,
        priceOre: post.priceOre,
        condition: post.condition,
        authorName: post.user.name,
        productSlug: post.product?.slug ?? null,
      },
      await loadPhotos(post.images.map((i) => i.key))
    );
    if (!messageId) return;
    // Såldes, raderades eller doldes annonsen medan Discord svarade finns ingen
    // aktiv rad att skriva på — då ska spegeln bort direkt.
    const saved = await prisma.communityPost.updateMany({
      where: { id: postId, isHidden: false, listingStatus: "ACTIVE", discordMessageId: null },
      data: { discordMessageId: messageId },
    });
    if (saved.count === 0) await deleteMarketPostsFromDiscord([messageId]);
  } catch (err) {
    console.error("[market-discord] misslyckades:", err instanceof Error ? err.message : err);
  }
}

/** Tar bort annonsens spegel och glömmer id:t (raden finns kvar: såld/avslutad/dold). */
export async function removeMarketPostFromDiscord(postId: string, messageId: string | null): Promise<void> {
  if (!messageId) return;
  await deleteMarketPostsFromDiscord([messageId]);
  await prisma.communityPost
    .updateMany({ where: { id: postId, discordMessageId: messageId }, data: { discordMessageId: null } })
    .catch(() => undefined);
}
