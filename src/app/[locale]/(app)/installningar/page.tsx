import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { loadSettingsUser } from "./settings-user";
import { SettingsIndex } from "./index-client";
import { SwipeBack } from "@/components/ui/swipe-back";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("pageTitle") };
}

export default async function SettingsPage() {
  const [user, t] = await Promise.all([loadSettingsUser(), getTranslations("Settings")]);
  return (
    <SwipeBack fallback="/mer" coverViewport>
    <div className="mx-auto max-w-md space-y-6">
      <SubpageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} fallback="/mer" />
      <Suspense>
        <SettingsIndex user={user} />
      </Suspense>
    </div>
    </SwipeBack>
  );
}
