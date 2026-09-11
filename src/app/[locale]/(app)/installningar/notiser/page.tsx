import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { loadSettingsUser } from "../settings-user";
import { NotificationsSection } from "../sections";
import { SwipeBack } from "@/components/ui/swipe-back";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("notifTitle") };
}

export default async function Page() {
  const [user, t] = await Promise.all([loadSettingsUser(), getTranslations("Settings")]);
  return (
    <SwipeBack fallback="/installningar" coverViewport>
    <div className="mx-auto max-w-md space-y-6">
      {/* ⛔ Bakåt landar på registret, aldrig på /mer: undersidan nåddes DÄRIFRÅN. */}
      <SubpageHeader title={t("notifTitle")} fallback="/installningar" />
      <Suspense>
        <NotificationsSection user={user} />
      </Suspense>
    </div>
    </SwipeBack>
  );
}
