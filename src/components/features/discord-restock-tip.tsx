"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { IconDiscord } from "@/components/ui/brand-icons";
import { IconX } from "@/components/ui/icons";
import { watchTipInviteUrl } from "@/lib/discord-invites";

/**
 * "Skylten": tipset om Discord-servern, visat i det ENDA ögonblick det är relevant —
 * direkt efter att någon skapat en bevakning.
 *
 * ⛔ PLACERINGEN ÄR HELA POÄNGEN (ägarbeslut 2026-08-16). Den som just tryckt
 * "Bevaka" har i samma sekund talat om att hen vill ha restock-larm; då är "de kommer
 * snabbare i Discord" ett svar på en fråga användaren själv ställde. Samma mening på
 * startsidan, eller i en popup vid ankomsten, är ett avbrott — den hade mött folk som
 * ännu inte vet vad Foilio är, OCH alla befintliga medlemmar (vi kan inte veta vem
 * som redan gått med utan att fråga servern, vilket kräver `auth()` och river ISR:en).
 *
 * ⚠️ COPYN LOVAR "OFTAST INOM EN MINUT", INTE "DIREKT". Mätt latens är ~45–60 s för
 * Shopify/Webhallen och ~2 min för de långsammare plattformarna
 * ([[project-discord-restock-fast-lane]]). "Direkt" är ett ord varje butiksnyhetsbrev
 * använder; en siffra vi faktiskt kan stå för är både sannare och mer trovärdig.
 */

const DISMISS_KEY = "fo_discord_tip_dismissed";
/** Hur länge ett avfärdande gäller. Tre månader ≈ "inte den här säsongen". */
const DISMISS_DAYS = 90;

function isDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return true; // Skräpvärde ⇒ tolka som avfärdat.
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // Privat läge/blockerad lagring: hellre visa tipset än krascha kortet.
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignoreras — tipset kommer tillbaka nästa gång, det är hela skadan */
  }
}

export function DiscordRestockTip() {
  // Renderar null till efter monteringen: localStorage finns bara i webbläsaren,
  // och att gissa hade gett hydreringsfel (samma skäl som SignupCampaignBanner).
  const [visible, setVisible] = useState(false);
  const t = useTranslations("DiscordTip");

  useEffect(() => {
    if (!isDismissed()) setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="mt-3 flex items-start gap-3 rounded-xl border border-holo-cyan/30 bg-holo-cyan/10 p-3">
      <IconDiscord size={18} className="mt-0.5 shrink-0 text-holo-cyan" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{t("title")}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{t("body")}</p>

        {/* Klickar man sig till servern är tipset förbrukat — då ska det inte
            dyka upp på nästa produkt heller. Avfärdandet är alltså inte bara
            "nej tack", det är också "ja tack, klart". */}
        <a
          href={watchTipInviteUrl()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            markDismissed();
            setVisible(false);
          }}
          className="mt-2 inline-block text-xs font-semibold text-holo-cyan hover:underline"
        >
          {t("cta")} →
        </a>
      </div>

      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={() => {
          markDismissed();
          setVisible(false);
        }}
        className="-m-1 shrink-0 rounded-lg p-1 text-ink-faint transition-colors hover:bg-surface-overlay/60 hover:text-ink"
      >
        <IconX size={16} />
      </button>
    </div>
  );
}
