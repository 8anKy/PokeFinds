/**
 * Postar EN befintlig köp/sälj/byt-annons till köp-trade-sälj-kanalen (samma väg som
 * en ny annons: services/market-discord.ts). För annonser från före speglingen.
 * Kör med Railways env (bot-token, S3, DB): `npx railway run npx tsx scripts/post-market-listing-to-discord.ts <postId>`
 * Utan id listas aktiva annonser som inte speglats. `--repost` tar bort befintlig spegel och postar om.
 */
import { prisma } from "@/lib/db";
import { removeMarketPostFromDiscord, syncMarketPostToDiscord } from "@/services/market-discord";

async function main() {
  const id = process.argv[2];
  if (!id) {
    const rows = await prisma.communityPost.findMany({
      where: { listingStatus: "ACTIVE", isHidden: false, discordMessageId: null, group: { isMarketplace: true } },
      select: { id: true, title: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    for (const r of rows) console.log(r.id, r.createdAt.toISOString().slice(0, 10), r.user.name, "—", r.title);
    return;
  }
  if (process.argv.includes("--repost")) {
    const cur = await prisma.communityPost.findUnique({ where: { id }, select: { discordMessageId: true } });
    await removeMarketPostFromDiscord(id, cur?.discordMessageId ?? null);
  }
  await syncMarketPostToDiscord(id);
  const after = await prisma.communityPost.findUnique({ where: { id }, select: { discordMessageId: true } });
  console.log(after?.discordMessageId ? `postad: ${after.discordMessageId}` : "INTE postad — se loggraden ovan");
}

main().finally(() => prisma.$disconnect());
