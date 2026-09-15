"use client";
/**
 * "SÅ FUNKAR BEVAKNINGAR" — arket som möter ett GRATISKONTO första gången det trycker
 * Bevaka (ägarbeslut 2026-09-15). Tre rader, inget mer: hur många bevakningar som
 * ingår, att ett restock-larm ingår men kommer några minuter efter Pro, och att Pro
 * larmar direkt på allt. Sedan knappen som bevakar — arket får aldrig bli ett
 * hinder mellan trycket och bevakningen; det är en förklaring, inte en grind.
 *
 * ⛔ EN GÅNG PER ENHET (localStorage). Varje Bevaka-tryck med ett ark framför sig
 *    hade blivit en irritation, och irritation säljer ingen Pro. Pro-konton ser
 *    det aldrig.
 * ⛔ Samma spak i copyn som överallt annars: `FREE_PLAN_WATCHLIST_LIMIT` och
 *    `FREE_RESTOCK_ALERT_DELAY_MINUTES` läses in — inga tal skrivna för hand.
 * ⛔ "Se Pro" öppnar paywall-ARKET (openPaywallOrNavigate), inte en ny sida.
 */
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { IconBell, IconClock, IconSparkle } from "@/components/ui/icons";
import { FREE_RESTOCK_ALERT_DELAY_MINUTES } from "@/lib/free-restock-alert";
import { FREE_PLAN_WATCHLIST_LIMIT } from "@/lib/watchlist-limits";
import { openPaywallOrNavigate } from "@/lib/paywall";
import type { ReactNode } from "react";

const SEEN_KEY = "foilio:free-watch-intro:v1";

/** Har enheten redan sett arket? Fel-säkert: kastar lagringen ⇒ "sett" (visa inte igen och igen). */
export function freeWatchIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markFreeWatchIntroSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Privat läge / blockerad lagring — arket visas då nästa gång, vilket är ofarligt.
  }
}

export function FreeWatchIntroSheet({
  open,
  onClose,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  /** "Bevaka" — anroparen fortsätter med själva bevakningen. */
  onContinue: () => void;
}) {
  const t = useTranslations("Watch.intro");
  const router = useRouter();

  return (
    <BottomSheet
      open={open}
      title={t("title")}
      onClose={onClose}
      closeLabel={t("close")}
      panelClassName="sm:mx-auto sm:max-w-md"
      footer={<BottomSheetCta onClick={onContinue}>{t("cta")}</BottomSheetCta>}
    >
      <ul className="flex flex-col gap-3">
        <Row icon={<IconBell size={18} />}>
          {t("rowWatches", { count: FREE_PLAN_WATCHLIST_LIMIT })}
        </Row>
        <Row icon={<IconClock size={18} />}>
          {t("rowAlert", { minutes: FREE_RESTOCK_ALERT_DELAY_MINUTES })}
        </Row>
        <Row icon={<IconSparkle size={18} />} accent>
          {t("rowPro")}
        </Row>
      </ul>
      <button
        type="button"
        onClick={() => {
          onClose();
          openPaywallOrNavigate(router, { source: "free-watch-intro" });
        }}
        className="mt-4 w-full rounded-lg py-2.5 text-sm font-medium text-holo-cyan transition-colors hover:bg-holo-cyan/10"
      >
        {t("seePro")}
      </button>
    </BottomSheet>
  );
}

function Row({ icon, accent, children }: { icon: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface p-3">
      <span className={accent ? "mt-0.5 shrink-0 text-holo-cyan" : "mt-0.5 shrink-0 text-ink-faint"}>{icon}</span>
      <span className="text-sm leading-snug text-ink">{children}</span>
    </li>
  );
}
