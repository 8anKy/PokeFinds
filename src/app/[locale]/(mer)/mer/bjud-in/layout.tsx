import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * ⛔ LAYOUTEN FINNS BARA FÖR TITELN (2026-08-17). Samma fälla som /skanna och
 * /gradera: `bjud-in/page.tsx` är `"use client"` (session läses via API:t) och
 * kan därför inte exportera `metadata` — sidan ärvde rot-layoutens `Meta.title`
 * ORDAGRANT. Extra tråkigt just här: inbjudningssidan är den man DELAR, och den
 * delade länken visade sajtens startsiderubrik.
 * ⚠️ Föräldern /mer har en egen titel via `generateMetadata`, men titlar ärvs
 * inte nedåt mellan segment — /mer/bjud-in behövde sin egen.
 *
 * ⛔ Ren genomsläppning — ingen wrapper, ingen styling, ingen provider.
 * ⛔ Ingen `auth()`/`cookies()`: (app)-layouten har redan gjort kontrollen.
 *
 * Titeln återanvänder sidans egen nyckel (`Invite.h1`) i stället för en hårdkodad
 * svensk sträng, så /en får engelsk titel utan nya katalogposter.
 */
export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Invite" });
  return { title: t("h1") };
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
