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

  // Native-appen (Capacitor/WKWebView) startar ALLTID om på apex utan locale-prefix,
  // så middlewaren kör om språkdetekteringen vid varje start och `Accept-Language`
  // vinner om ingen cookie finns. Skriv därför NEXT_LOCALE explicit (1 år).
  //
  // ⛔ RADEN RÄCKTE INTE I SIG. next-intls klientrouter kallar `syncLocaleCookie`
  // vid varje locale-byte och skriver SAMMA cookie EFTER den här raden — med
  // livslängden ur `routing.localeCookie`. Stod den på default (ingen livslängd)
  // ersattes 1-årscookien av en SESSIONSCOOKIE, och språkvalet överlevde inte
  // nästa omstart: EN→SV "fastnade" inte. Livslängden bor därför i
  // `src/i18n/routing.ts` (vaktat av tests/unit/locale-cookie.test.ts); den här
  // raden är kvar för fallet att `usePathname()` är null och routern bailar.
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
