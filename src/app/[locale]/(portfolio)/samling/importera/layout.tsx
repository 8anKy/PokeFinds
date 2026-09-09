import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * ⛔ LAYOUTEN FINNS BARA FÖR TITELN. `importera/page.tsx` är `"use client"`
 * (filen läses i webbläsaren) och kan därför inte exportera `metadata` — utan
 * den här ärver sidan rot-layoutens titel ordagrant.
 * ⛔ Ingen `auth()`/`cookies()`: skulle göra hela grenen dynamisk.
 */
export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "CollectionImport" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
