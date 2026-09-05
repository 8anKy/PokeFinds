import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPro } from "@/lib/plan";
import { discordLinkingEnabled } from "@/lib/discord";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { communityV2Request } from "@/lib/community-v2-server";
import { prisma } from "@/lib/db";
// ⛔ Delad läsare — se src/lib/notification-settings.ts. Skriv ingen lokal kopia.
import { parseNotificationSettings } from "@/lib/notification-settings";
import { SettingsClient, type SettingsUser } from "./settings-client";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { allowsPurchaseRequests } from "@/lib/purchase-requests";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("pageTitle") };
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const t = await getTranslations("Settings");

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

  const settingsUser: SettingsUser = {
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
    // Community v2-grinden (Tradera-annonser på profilen bor bakom den). Sidan
    // är force-dynamic, så UA + roll läses per besök precis som env-spakarna.
    communityV2: await communityV2Request(session.user.role),
    discordUsername: user.discordUsername,
    // Kortet döljs helt när integrationen är avstängd — en knapp som bara kan
    // svara "inte tillgänglig" är sämre än ingen knapp. Sidan är force-dynamic,
    // så env läses vid varje besök och spaken slår igenom utan ombyggnad.
    // LINKING, inte bara bot: kortets knapp startar ett OAuth-flöde, så den ska
    // döljas även om bara client secret saknas.
    discordEnabled: discordLinkingEnabled(),
    // Sidan är force-dynamic → env läses vid varje besök, precis som
    // discordEnabled ovan. Ett reglage som inte kan göra något ska inte gå
    // att slå på.
    restockPaused: restockAlertsPaused(),
  };

  return (
    <div className="space-y-8">
      <div>
        <SubpageHeader title={t("pageTitle")} />
        <p className="text-sm text-ink-muted lg:hidden">{t("pageSubtitle")}</p>
        <p className="mt-1 hidden text-sm text-ink-muted lg:block">{t("pageSubtitle")}</p>
      </div>
      <Suspense>
        <SettingsClient user={settingsUser} />
      </Suspense>
    </div>
  );
}
