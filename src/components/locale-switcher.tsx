"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

// Byter språk genom att navigera till SAMMA sida i den andra localen. next-intl gör
// en mjuk (soft) navigering — sidan byts ut utan omladdning/frysning.
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  // Native-appen (Capacitor/WKWebView) startar ALLTID om på https://www.foilio.se
  // (utan locale-prefix), så middlewaren kör om språkdetektering vid varje start.
  // next-intl:s mjuka navigering sätter inte alltid en beständig cookie i WKWebView
  // → på en engelsk enhet vann Accept-Language och appen föll tillbaka till EN.
  // Skriv därför NEXT_LOCALE-cookien explicit (1 år) — den överlever omstart och är
  // exakt vad middlewaren läser. Idempotent med next-intl:s egen cookie (samma namn).
  function selectLocale(l: string) {
    document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
    router.replace(pathname, { locale: l });
  }

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-surface-border text-xs font-medium">
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => selectLocale(l)}
          aria-current={l === locale}
          className={
            l === locale
              ? "bg-holo-cyan/15 px-3 py-1.5 text-holo-cyan"
              : "px-3 py-1.5 text-ink-muted transition-colors hover:text-ink"
          }
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
