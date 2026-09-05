"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "foilio-cookie-consent";

export function CookieBanner() {
  // Följer språket — bannern var hårdkodad på svenska och låg kvar så i /en/.
  const t = useTranslations("Cookies");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      // Visa INTE bannern i native-appen (WKWebView): den fixed-positionerade rutan
      // täcker bottenmenyn, och en cookie-popup i en app är märklig. Bara nödvändiga
      // cookies (inloggning/funktion) används → inget samtyckeskrav.
      const isNative = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.();
      if (isNative) return;
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage otillgänglig (t.ex. privat läge) — visa inte bannern
    }
  }, []);

  function accept() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "accepted");
    } catch {
      // ignorera
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t("bannerAria")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-surface-border bg-surface-overlay/95 p-4 backdrop-blur-lg animate-fade-in"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {t("bannerText")}{" "}
          <Link href="/integritetspolicy" className="text-holo-cyan underline-offset-2 hover:underline">
            {t("bannerLink")}
          </Link>
          .
        </p>
        <Button size="sm" onClick={accept} className="shrink-0">
          {t("bannerOk")}
        </Button>
      </div>
    </div>
  );
}
