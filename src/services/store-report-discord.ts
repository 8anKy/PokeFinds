/**
 * EN väg från en butiksrapport till Discords butikslarm-kanal: läs rapporten färskt,
 * posta första gången, REDIGERA samma meddelande därefter (bekräftelser). Ett nytt
 * inlägg per bekräftelse hade spammat kanalen och splittrat samma hylla på flera rader.
 *
 * ⛔ Kastar aldrig — anropas fire-and-forget efter att skrivningen är sparad.
 */
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { imageUrl } from "@/lib/object-storage";
import { STORE_OBSERVATIONS, type StoreObservation } from "@/lib/community-stores";
import {
  deleteStoreReportFromDiscord,
  editStoreReportInDiscord,
  postStoreReportToDiscord,
  type StoreReportPost,
} from "@/lib/discord-store-report";
import { storeLogoUrl } from "@/services/community-stores";
import { tallyVotes } from "@/lib/store-report-votes";

/** Statusarkets standardtext när kommentaren lämnas tom — då finns ingen kommentar att citera. */
async function isDefaultReportText(content: string): Promise<boolean> {
  for (const locale of ["sv", "en"]) {
    const t = await getTranslations({ locale, namespace: "LocalStores" });
    if (STORE_OBSERVATIONS.some((o) => t(`observation.${o}`) === content.trim())) return true;
  }
  return false;
}

async function loadStoreReportPost(postId: string): Promise<{ post: StoreReportPost; messageId: string | null } | null> {
  const r = await prisma.communityStoreReport.findUnique({
    where: { postId },
    include: {
      store: { select: { id: true, name: true, address: true, city: true, latitude: true, longitude: true } },
      post: {
        select: {
          content: true,
          isHidden: true,
          userId: true,
          user: { select: { name: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { key: true } },
        },
      },
      confirmations: { select: { kind: true, createdAt: true, userId: true } },
    },
  });
  // Ett dolt inlägg får aldrig (åter)publiceras i Discord.
  if (!r || r.post.isHidden || r.priceOre == null) return null;
  const product = r.productSlug
    ? await prisma.product.findFirst({
        where: { slug: r.productSlug },
        select: { imageUrl: true, settledValueOre: true, settledValueFromCm: true },
      })
    : null;
  const firstKey = r.post.images[0]?.key;
  return {
    messageId: r.discordMessageId,
    post: {
      postId,
      observation: r.observation as StoreObservation,
      observedAt: r.observedAt,
      productLabel: r.productLabel,
      productSlug: r.productSlug,
      productImageUrl: product?.imageUrl ?? null,
      // ⛔ Bara ett Cardmarket-värde är ett marknadsvärde (src/lib/market-compare.ts).
      marketValueOre: product?.settledValueFromCm ? product.settledValueOre : null,
      priceOre: r.priceOre,
      comment: (await isDefaultReportText(r.post.content)) ? null : r.post.content,
      photoUrl: firstKey ? await imageUrl(firstKey).catch(() => null) : null,
      authorName: r.post.user.name,
      nearbyAtSubmit: r.nearbyAtSubmit,
      ...tallyVotes(r.confirmations, r.post.userId),
      store: { ...r.store, logoUrl: storeLogoUrl(r.store) },
    },
  };
}

export async function syncStoreReportToDiscord(postId: string): Promise<void> {
  try {
    const loaded = await loadStoreReportPost(postId);
    if (!loaded) return;
    if (loaded.messageId) {
      await editStoreReportInDiscord(loaded.messageId, loaded.post);
      return;
    }
    const messageId = await postStoreReportToDiscord(loaded.post);
    if (!messageId) return;
    // Raderades inlägget medan Discord svarade finns ingen rad att skriva på — då
    // ska spegeln bort också.
    await prisma.communityStoreReport
      .update({ where: { postId }, data: { discordMessageId: messageId } })
      .catch(() => deleteStoreReportFromDiscord([messageId]));
  } catch (err) {
    console.error("[store-report-discord] misslyckades:", err instanceof Error ? err.message : err);
  }
}

/**
 * Röster redigerar Discord-inlägget först när det varit tyst ~10 s: en rad snabba
 * tryck (eller ett ångrat) blir EN redigering med slutläget, och inlägget blinkar inte
 * mellan "finns kvar" och "inte kvar". Rösten i appen sparas och syns direkt ändå.
 * In-memory per process (Railway kör en); en omstart mitt i fönstret tappar bara
 * redigeringen — nästa röst tar igen den.
 */
export const VOTE_SYNC_DELAY_MS = 10_000;
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleStoreReportSync(postId: string, delayMs = VOTE_SYNC_DELAY_MS): void {
  const existing = pendingSyncs.get(postId);
  if (existing) clearTimeout(existing);
  pendingSyncs.set(
    postId,
    setTimeout(() => {
      pendingSyncs.delete(postId);
      void syncStoreReportToDiscord(postId);
    }, delayMs)
  );
}
