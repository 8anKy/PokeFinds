"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconPackage } from "@/components/ui/icons";

/**
 * "Restock-larmen är pausade" — samma besked på varje yta som annars hade
 * antytt att larmen går ut.
 *
 * ⛔ VARFÖR DEN FINNS: pausen 2026-08-23 stängde av larmen men rörde inte ETT
 * ord av copyn. Reglagen i inställningarna och bevakningslistan gick fortfarande
 * att slå på, paywallen sålde fortfarande "alla restock-larm", och två kunder
 * hann betala 49 kr/mån för det. Ett avstängt larm är ett driftbeslut; ett
 * reglage som påstår att larmet är på är ett felaktigt påstående.
 *
 * ⛔ SÄG ALDRIG BARA "PAUSAT". Beskedet måste bära vad som FORTFARANDE gäller
 * (bevakningarna ligger kvar, prislarm fungerar) — annars läser användaren det
 * som att hela bevakningen är död och tar bort den.
 */
export function RestockPausedBanner({ className }: { className?: string }) {
  const t = useTranslations("RestockPause");
  return (
    <div
      className={
        "rounded-xl border border-holo-gold/30 bg-holo-gold/5 px-4 py-3 text-sm text-ink-muted " +
        (className ?? "")
      }
    >
      <p className="flex items-start gap-2">
        <IconPackage size={16} className="mt-0.5 shrink-0 text-holo-gold" />
        <span>{t("banner")}</span>
      </p>
      <p className="mt-2 pl-6">
        {t("bannerDiscord")}{" "}
        <Link href="/discord" className="font-medium text-holo-cyan underline-offset-2 hover:underline">
          {t("discordCta")}
        </Link>
      </p>
    </div>
  );
}
