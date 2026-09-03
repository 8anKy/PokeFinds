import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Kopplar från Tradera-kontot (raderar sparad token). Tar också tillbaka
 * samtycket "visa mina Tradera-annonser på min profil": utan koppling finns
 * inget att visa, och en kvarlämnad sann flagga hade återupptagit visningen
 * tyst vid nästa koppling — kanske till ett annat Tradera-konto.
 */
export async function DELETE() {
  try {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        traderaUserId: null,
        traderaToken: null,
        traderaTokenExpiresAt: null,
        showTraderaListings: false,
      },
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
