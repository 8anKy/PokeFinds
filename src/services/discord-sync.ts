/**
 * Håller Discord-rollerna i takt med vem som faktiskt har Pro.
 *
 * EN definition av Pro: `isPro()` i src/lib/plan.ts. Discord får ALDRIG en egen
 * regel — en andra uppsättning villkor hade glidit isär från den första, och det
 * felet är tyst (se `proUserWhere()`-varningen: en glömd gren gav Pro i
 * gränssnittet men inga larm).
 *
 * ⛔ VI RÖR BARA KONTON VI SJÄLVA HAR LÄNKAT. Roller som ägaren delat ut för hand
 * i Discord lämnas orörda — vi tar aldrig bort en roll vi inte satt. Därför utgår
 * allt här från `User.discordUserId`, aldrig från serverns medlemslista.
 */
import { prisma, withDbRetry } from "@/lib/db";
import { isPro, type ProUserShape } from "@/lib/plan";
import { addRole, discordBotConfig, removeRole } from "@/lib/discord";

/**
 * Fälten `isPro()` behöver. ⛔ Alla fyra MÅSTE väljas: ett ovalt fält blir
 * `undefined`, och då failar vakten ÖPPET (samma familj som `variantLabel`
 * 2026-07-28 och `stripeProUntil` i users/me). Konstanten finns för att ingen
 * anropare ska kunna skriva sin egen halva select.
 */
export const DISCORD_SYNC_SELECT = {
  id: true,
  discordUserId: true,
  planTier: true,
  role: true,
  bonusProUntil: true,
  stripeProUntil: true,
} as const;

type SyncUser = ProUserShape & { id: string; discordUserId: string | null };

export interface DiscordSyncResult {
  /** Kontot var länkat och vi försökte något. */
  attempted: boolean;
  /** Alla anrop lyckades. */
  ok: boolean;
  /** Vad vi räknade fram — inte vad Discord svarade. */
  pro: boolean;
}

const SKIPPED: DiscordSyncResult = { attempted: false, ok: true, pro: false };

/**
 * Ger/tar Pro-rollen för ETT konto utifrån `isPro()`.
 *
 * ⛔ Kastar ALDRIG. Anroparna är betalnings-webhooks och kontoradering, och där
 * vore ett Discord-fel det sämsta tänkbara skälet att fela: Stripe hade gjort om
 * försöket i tre dygn för en rollsättning, och en radering hade kunnat avbrytas
 * halvvägs. Misslyckas något loggas det och nattjobbet rättar det inom ett dygn.
 */
export async function syncDiscordRoles(
  userOrId: string | SyncUser,
  reason: string
): Promise<DiscordSyncResult> {
  const config = discordBotConfig();
  if (!config) return SKIPPED;

  try {
    const user =
      typeof userOrId === "string"
        ? await withDbRetry(() =>
            prisma.user.findUnique({ where: { id: userOrId }, select: DISCORD_SYNC_SELECT })
          )
        : userOrId;
    if (!user?.discordUserId) return SKIPPED;

    const pro = isPro(user);
    // Verifierad sätts om vid varje synk med flit: rollen kan ha tagits bort för
    // hand i Discord, och en länkning som inte syns i servern är värdelös.
    const verified = await addRole(user.discordUserId, config.roleVerified, reason);
    const proOk = pro
      ? await addRole(user.discordUserId, config.rolePro, reason)
      : await removeRole(user.discordUserId, config.rolePro, reason);

    return { attempted: true, ok: verified && proOk, pro };
  } catch (err) {
    console.error("[discord] rollsynk misslyckades:", err);
    return { attempted: true, ok: false, pro: false };
  }
}

/**
 * Tar bort BÅDA rollerna. Används vid frånkoppling och kontoradering.
 *
 * ⛔ Medlemskapet rörs aldrig (ägarbeslut): vi kickar ingen. Den som säger upp
 * Pro eller raderar sitt konto ska inte kastas ut ur communityn — bara sluta
 * bära en roll som inte längre är sann.
 *
 * ⛔ Tar `discordUserId` direkt, inte ett användar-id: vid kontoradering är
 * raden på väg att försvinna, och en uppslagning efteråt hade kommit för sent.
 */
export async function revokeDiscordRoles(
  discordUserId: string | null | undefined,
  reason: string
): Promise<boolean> {
  const config = discordBotConfig();
  if (!config || !discordUserId) return true;
  try {
    const pro = await removeRole(discordUserId, config.rolePro, reason);
    const verified = await removeRole(discordUserId, config.roleVerified, reason);
    return pro && verified;
  } catch (err) {
    console.error("[discord] kunde inte ta bort roller:", err);
    return false;
  }
}
