import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { hasRole } from "@/lib/auth";
import { readSessionLite } from "@/lib/session-lite";
import { giveawayConfig, giveawayPhase } from "@/lib/giveaway";

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

/**
 * ⛔ DOLD FÖRE STARTEN (ägarbeslut 2026-10-13): en gissad/läckt URL ger 404 tills
 * `startsAt`. Admin (MODERATOR+) ser sidan ändå, för att kunna testa den.
 * Sessionen ur cookien — ingen DB, ingen auth() i layouten.
 */
export default async function GiveawayLayout({ children }: { children: React.ReactNode }) {
  if (giveawayPhase(giveawayConfig(), new Date()) === "upcoming") {
    const session = await readSessionLite();
    if (!session || !hasRole(session.role as Role, "MODERATOR")) notFound();
  }
  return <>{children}</>;
}
