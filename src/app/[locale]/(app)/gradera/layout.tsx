import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * ⛔ LAYOUTEN FINNS BARA FÖR TITELN (2026-08-17). Samma rotorsak som /skanna:
 * `gradera/page.tsx` är `"use client"` och kan därför inte exportera `metadata`,
 * så sidan ärvde rot-layoutens `Meta.title` ORDAGRANT och utgav sig för att vara
 * startsidan i flik, historik, bokmärken och delade länkar.
 *
 * ⛔ Ren genomsläppning — ingen wrapper, ingen styling, ingen provider. En extra
 * DOM-nod här vore en visuell ändring av en sida vars mått är uppmätta.
 * ⛔ Ingen `auth()`/`cookies()`: (app)-layouten har redan gjort kontrollen.
 *
 * Titeln återanvänder sidans egen nyckel (`Grading.h1`) i stället för en
 * hårdkodad svensk sträng, så /en får engelsk titel utan nya katalogposter.
 */
export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Grading" });
  return { title: t("h1") };
}

export default function GradeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
