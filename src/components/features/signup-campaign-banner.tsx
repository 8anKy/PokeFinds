"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { dateLocaleTag } from "@/lib/format";
import { useAuthHint } from "@/lib/auth-hint";
import {
  campaignIsOpen,
  signupCampaignFromEnv,
  DEFAULT_SIGNUP_BONUS_MONTHS,
} from "@/lib/signup-campaign";

/**
 * Kampanjremsa: "X månader Pro gratis — registrera dig före den DATUM".
 *
 * ⛔ **BANNERN ÄR INTE KOSMETIK.** Kreatörens video säger "registrera dig och få
 * gratis Pro"; landar besökaren på en sida som inte nämner det med ett ord drar hen
 * slutsatsen att erbjudandet inte finns (eller att videon överdrev) och stänger
 * fliken. Remsan är beviset som gör klicket till en registrering.
 *
 * ⛔ **BARA WEBBEN (ägarbeslut).** I appen döljs den: `Capacitor.isNativePlatform()`.
 * Kampanjen riktar sig till nya besökare från TikTok, och app-användaren har redan
 * ett konto — för hen vore remsan en uppmaning att göra något hen redan gjort.
 *
 * ⛔ **BARA UTLOGGADE.** `fo_auth`-hinten, inte ett API-anrop: sidorna den sitter på
 * är ISR-cachade och får inte bli dynamiska (se Caching/ISR i CLAUDE.md).
 *
 * ⚠️ Renderar null till efter monteringen. Kampanjdatumet är inbakat vid bygget och
 * lika på server och klient, men "är appen native" och "är någon inloggad" går bara
 * att veta i webbläsaren — att gissa hade gett hydreringsfel.
 */
export function SignupCampaignBanner() {
  const t = useTranslations("SignupCampaign");
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  const authed = useAuthHint();

  useEffect(() => setMounted(true), []);

  const config = signupCampaignFromEnv();
  if (!campaignIsOpen(config, new Date())) return null;
  if (!mounted || authed !== false) return null;

  const isNative = (
    globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.();
  if (isNative) return null;

  const months = Number.parseInt(String(config.months ?? ""), 10);
  const monthLabel =
    Number.isFinite(months) && months > 0 ? months : DEFAULT_SIGNUP_BONUS_MONTHS;
  const deadline = new Date(`${config.until}T23:59:59.999Z`).toLocaleDateString(
    dateLocaleTag(locale),
    { day: "numeric", month: "long" }
  );

  return (
    <div className="border-b border-holo-cyan/25 bg-holo-cyan/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2.5 py-2 text-center text-sm sm:px-6">
        <span className="font-semibold text-holo-cyan">
          {t("headline", { months: monthLabel })}
        </span>
        <span className="text-ink-muted">{t("deadline", { date: deadline })}</span>
        <Link
          href="/registrera"
          className="font-semibold text-ink underline underline-offset-2 hover:text-holo-cyan"
        >
          {t("cta")}
        </Link>
      </div>
    </div>
  );
}
