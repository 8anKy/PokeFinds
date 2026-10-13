import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Bara för titeln — sidan är `"use client"` och kan inte exportera metadata
 * (samma mönster som /mer/bjud-in). Länken delas från TikTok/Instagram.
 */
export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Giveaway" });
  return { title: t("metaTitle") };
}

export default function GiveawayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
