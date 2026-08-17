import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * ⛔ LAYOUTEN FINNS BARA FÖR TITELN (2026-08-17). `skanna/page.tsx` är
 * `"use client"` och kan därför INTE exportera `metadata` — Next läser bara
 * metadata ur serverkomponenter, tyst och utan fel. Följden var att skannern
 * ärvde rot-layoutens `Meta.title` ORDAGRANT och påstod sig vara startsidan i
 * flik, historik, bokmärken och delade länkar. En serverlayout som syskon är
 * enda vägen in med titeln utan att göra om sidan till en serverkomponent.
 *
 * ⛔ Layouten MÅSTE vara en ren genomsläppning: en enda extra DOM-nod här är en
 * VISUELL ändring (skannern är `fixed inset-0 z-[60]` och sidans luft/höjd är
 * uppmätt i `ui-shell.md`). Ingen wrapper, ingen styling, ingen provider.
 * ⛔ Ingen `auth()`/`cookies()` här — (app)-layouten gör redan den kontrollen,
 * och en till hade bara kostat.
 *
 * Titeln återanvänder befintlig nyckel i stället för en hårdkodad svensk sträng,
 * så /en får engelsk titel utan nya poster i katalogerna.
 */
export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Scanner" });
  return { title: t("captureTitle") };
}

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
