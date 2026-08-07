import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { revokeDiscordRoles } from "@/services/discord-sync";

export const dynamic = "force-dynamic";

/**
 * Kopplar från Discord-kontot.
 *
 * Rollerna tas bort FÖRE skrivningen: efteråt är `discordUserId` borta och vi
 * vet inte längre vilket konto som skulle städas. Medlemskapet i servern rörs
 * aldrig — frånkoppling betyder "sluta hävda att jag har Pro", inte "kasta ut mig".
 */
export async function DELETE() {
  try {
    const sessionUser = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { discordUserId: true },
    });

    await revokeDiscordRoles(user?.discordUserId, "Foilio: användaren kopplade från kontot");

    await prisma.user.update({
      where: { id: sessionUser.id },
      data: { discordUserId: null, discordUsername: null, discordLinkedAt: null },
    });

    if (user?.discordUserId) {
      await prisma.auditLog.create({
        data: {
          userId: sessionUser.id,
          action: "user.discord.unlinked",
          entityType: "User",
          entityId: sessionUser.id,
          metadata: { discordUserId: user.discordUserId },
        },
      });
    }
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
