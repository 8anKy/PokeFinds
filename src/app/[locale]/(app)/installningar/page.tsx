import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPro } from "@/lib/plan";
import { discordLinkingEnabled } from "@/lib/discord";
import { prisma } from "@/lib/db";
import { SettingsClient, type NotificationSettings, type SettingsUser } from "./settings-client";
import { PageBackButton } from "@/components/layout/page-back-button";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("pageTitle") };
}

function parseNotificationSettings(json: unknown): NotificationSettings {
  const defaults: NotificationSettings = {
    email: true,
    push: false,
    allRestocks: false,
  };
  if (typeof json !== "object" || json === null) return defaults;
  const o = json as Record<string, unknown>;
  return {
    email: typeof o.email === "boolean" ? o.email : defaults.email,
    push: typeof o.push === "boolean" ? o.push : defaults.push,
    allRestocks: typeof o.allRestocks === "boolean" ? o.allRestocks : defaults.allRestocks,
  };
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
    notificationSettings: parseNotificationSettings(user.notificationSettings),
    traderaUserId: user.traderaUserId,
    discordUsername: user.discordUsername,
    // Kortet döljs helt när integrationen är avstängd — en knapp som bara kan
    // svara "inte tillgänglig" är sämre än ingen knapp. Sidan är force-dynamic,
    // så env läses vid varje besök och spaken slår igenom utan ombyggnad.
    // LINKING, inte bara bot: kortets knapp startar ett OAuth-flöde, så den ska
    // döljas även om bara client secret saknas.
    discordEnabled: discordLinkingEnabled(),
  };

  return (
    <div className="space-y-8">
      <div>
        <PageBackButton />
        <h1 className="font-display text-2xl font-bold text-ink">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("pageSubtitle")}
        </p>
      </div>
      <Suspense>
        <SettingsClient user={settingsUser} />
      </Suspense>
    </div>
  );
}
