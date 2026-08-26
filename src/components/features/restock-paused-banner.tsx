"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconPackage } from "@/components/ui/icons";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";

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
 * (bevakningarna och målpriserna ligger kvar) — annars läser användaren det
 * som att hela bevakningen är död och tar bort den.
 *
 * ⛔ TRE BESKED, INTE ETT. Prislarmen pausades 2026-08-26 av egna skäl (se
 * `price-alerts-pause.ts`), och den gamla texten sa uttryckligen "prislarm
 * fungerar som vanligt" — sant fram till den dagen, en lögn efter den. Vilket
 * besked som visas avgörs HÄR, av flaggorna, inte av anropsstället: den som
 * lägger banderollen på en ny yta ska inte behöva minnas kombinationerna.
 * Ingendera pausad → ingen banderoll alls, oavsett vad anroparen tror.
 */
export function RestockPausedBanner({ className }: { className?: string }) {
  const t = useTranslations("RestockPause");
  const restockPaused = restockAlertsPausedClient();
  const pricePaused = priceAlertsPausedClient();
  if (!restockPaused && !pricePaused) return null;
  const messageKey = restockPaused && pricePaused ? "bannerBoth" : restockPaused ? "banner" : "bannerPrice";
  return (
    <div
      className={
        "rounded-xl border border-holo-gold/30 bg-holo-gold/5 px-4 py-3 text-sm text-ink-muted " +
        (className ?? "")
      }
    >
      <p className="flex items-start gap-2">
        <IconPackage size={16} className="mt-0.5 shrink-0 text-holo-gold" />
        <span>{t(messageKey)}</span>
      </p>
      {/* Discord-utvägen gäller BARA restocks. Står den under ett rent prislarms-
          besked lovar den en ersättning som inte finns — kanalen postar påfyllningar,
          aldrig målpriser. */}
      {restockPaused && (
        <p className="mt-2 pl-6">
          {t("bannerDiscord")}{" "}
          <Link href="/discord" className="font-medium text-holo-cyan underline-offset-2 hover:underline">
            {t("discordCta")}
          </Link>
        </p>
      )}
    </div>
  );
}
