import { prisma } from "@/lib/db";
import { sendPush, type PushPayload } from "@/lib/apns";
import { parseNotificationSettings } from "@/lib/notification-settings";

/**
 * Push till EN användare (nytt meddelande, nytt svar i en tråd). Delad av
 * chatten och forumet så regeln bor på ett ställe:
 *   · användarens `notificationSettings.push` måste vara på,
 *   · det måste finnas registrerade enhetstokens,
 *   · tokens APNs förkastar städas bort direkt (samma mönster som larmen).
 *
 * Fel SVÄLJS och loggas: meddelandet/svaret är redan sparat och levererat i
 * appen — en trasig push får aldrig fälla skrivningen. Returnerar hur många
 * enheter som fick pushen (0 = inget skickat, av vilket skäl som helst).
 *
 * Kostnad: två små läsningar (User + PushToken) — anropas bara när något
 * FAKTISKT skrivits, aldrig på en timer.
 */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  try {
    const [user, tokens] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { notificationSettings: true } }),
      prisma.pushToken.findMany({ where: { userId }, select: { token: true } }),
    ]);
    if (!user || tokens.length === 0) return 0;
    if (!parseNotificationSettings(user.notificationSettings).push) return 0;

    const list = tokens.map((t) => t.token);
    const { invalidTokens } = await sendPush(list, payload);
    if (invalidTokens.length > 0) {
      await prisma.pushToken.deleteMany({ where: { token: { in: invalidTokens } } }).catch(() => undefined);
    }
    return list.length - invalidTokens.length;
  } catch (err) {
    console.error("[push-to-user] misslyckades:", err instanceof Error ? err.message : err);
    return 0;
  }
}
