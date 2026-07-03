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

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-surface-border text-xs font-medium">
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => router.replace(pathname, { locale: l })}
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
