import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPro } from "@/lib/plan";
import { discordLinkingEnabled } from "@/lib/discord";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { communityV2Request } from "@/lib/community-v2-server";
import { prisma } from "@/lib/db";
// ⛔ Delad läsare — se src/lib/notification-settings.ts. Skriv ingen lokal kopia.
import { parseNotificationSettings } from "@/lib/notification-settings";
import { allowsPurchaseRequests } from "@/lib/purchase-requests";
import type { NotificationSettings } from "@/lib/notification-settings";

export interface SettingsUser {
  name: string;
  email: string;
  bio: string | null;
  planTier: "FREE" | "PREMIUM";
  /** Pro-förmåner (planTier ELLER admin-roll) — grinda features på denna, ej planTier. */
  isPro: boolean;
  /** ISO-datum när en GRATIS Pro-period tar slut, annars null. */
  bonusProUntil: string | null;
  notificationSettings: NotificationSettings;
  traderaUserId: string | null;
  /** "Visa mina Tradera-annonser på min profil" — bara meningsfull när kopplad. */
  showTraderaListings: boolean;
  /** "Visa min samling på min profil" — profilens Portfölj-flik för andra. */
  isPublicCollection: boolean;
  /** "Tillåt köpförfrågningar" — knappen "Är den till salu?" på rutorna (preferences-JSON). */
  allowPurchaseRequests: boolean;
  /** Community v2 (forum/meddelanden/Tradera på profilen) synligt för den här besökaren? */
  communityV2: boolean;
  /** Discord-visningsnamnet när kontot är länkat, annars null. */
  discordUsername: string | null;
  /** Är integrationen påslagen i miljön? Falskt → kopplingen visas inte alls. */
  discordEnabled: boolean;
  /** Restock-larmen avstängda? Då får "Alla restocks" inte gå att slå på. */
  restockPaused: boolean;
}

/**
 * EN läsning av allt inställningssidorna behöver — delad av registret och alla
 * fem undersidor.
 *
 * ⛔ EN källa, inte sex. Sedan inställningarna delades i undersidor (2026-09-09)
 * laddar varje sida samma användare, och en lokal `select` per sida hade garanterat
 * att de gled isär: den dagen ett fält läggs till hade tre sidor haft det och två
 * inte, och buggen syns bara på den sida ingen öppnade under testet.
 *
 * Läsningen är smal och sidorna är `force-dynamic` — men det är EN fråga per
 * öppnad undersida i stället för en för hela sidan. Inställningar öppnas sällan
 * och alltid mitt i en session där Neon redan är vaken, så det köper inga nya
 * väckningar; det är ändå skälet att inte lägga fler fält här än de som används.
 */
export async function loadSettingsUser(): Promise<SettingsUser> {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      bio: true,
      planTier: true,
      role: true,
      bonusProUntil: true,
      stripeProUntil: true, // utan denna säger isPro() FREE för en betalande webbkund
      notificationSettings: true,
      traderaUserId: true,
      showTraderaListings: true,
      isPublicCollection: true,
      preferences: true, // allowPurchaseRequests — se lib/purchase-requests.ts
      discordUsername: true,
    },
  });
  if (!user) redirect("/logga-in");

  return {
    name: user.name,
    email: user.email,
    bio: user.bio,
    planTier: user.planTier,
    isPro: isPro(user),
    // Gratis Pro-period (kampanj eller inbjudningsbonus) — visas med DATUM, aldrig
    // bara som "Pro". En användare som inte vet att perioden tar slut upplever
    // bortfallet av restock-larm som att appen gått sönder. Sätts bara när bonusen
    // är det som FAKTISKT ger Pro: har personen betalat är slutdatumet irrelevant.
    bonusProUntil:
      user.bonusProUntil &&
      user.bonusProUntil.getTime() > Date.now() &&
      !isPro({ ...user, bonusProUntil: null })
        ? user.bonusProUntil.toISOString()
        : null,
    notificationSettings: parseNotificationSettings(user.notificationSettings),
    traderaUserId: user.traderaUserId,
    showTraderaListings: user.showTraderaListings,
    isPublicCollection: user.isPublicCollection,
    allowPurchaseRequests: allowsPurchaseRequests(user.preferences),
    // Community v2-grinden (Tradera-annonser på profilen bor bakom den). Sidorna
    // är force-dynamic, så UA + roll läses per besök precis som env-spakarna.
    communityV2: await communityV2Request(session.user.role),
    discordUsername: user.discordUsername,
    // Kopplingen döljs helt när integrationen är avstängd — en knapp som bara kan
    // svara "inte tillgänglig" är sämre än ingen knapp. Sidorna är force-dynamic,
    // så env läses vid varje besök och spaken slår igenom utan ombyggnad.
    // LINKING, inte bara bot: knappen startar ett OAuth-flöde, så den ska döljas
    // även om bara client secret saknas.
    discordEnabled: discordLinkingEnabled(),
    // force-dynamic → env läses vid varje besök, precis som discordEnabled ovan.
    // Ett reglage som inte kan göra något ska inte gå att slå på.
    restockPaused: restockAlertsPaused(),
  };
}
