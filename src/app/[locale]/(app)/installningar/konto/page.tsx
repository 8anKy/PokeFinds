import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { loadSettingsUser } from "../settings-user";
import { AccountSection } from "../sections";
import { SwipeBack } from "@/components/ui/swipe-back";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("gdprTitle") };
}

export default async function Page() {
  const [, t] = await Promise.all([loadSettingsUser(), getTranslations("Settings")]);
  return (
    <SwipeBack fallback="/installningar">
    <div className="mx-auto max-w-md space-y-6">
      {/* ⛔ Bakåt landar på registret, aldrig på /mer: undersidan nåddes DÄRIFRÅN. */}
      <SubpageHeader title={t("gdprTitle")} fallback="/installningar" />
      <Suspense>
        <AccountSection />
      </Suspense>
    </div>
    </SwipeBack>
  );
}
