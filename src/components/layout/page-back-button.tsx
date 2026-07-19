"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { IconChevronLeft } from "@/components/ui/icons";

/**
 * Bakåtknapp för Mer-tabbens undersidor (Bevakningar, AI-gradering, Prenumeration,
 * Inställningar, Support, Adminpanel, Bjud in). Dessa är RIKTIGA rutter (inte
 * overlays som produktsidan) → router.back() följer webbläsarhistoriken; landar
 * man här via djuplänk/utan historik faller vi tillbaka på `fallback` (/mer).
 *
 * BARA mobil (lg:hidden): i bottom-tab-vyn saknas bakåtväg helt. På desktop finns
 * en permanent sidomeny där varje sektion är ett klick bort → en bakåtknapp där
 * vore bara brus.
 */
export function PageBackButton({ fallback = "/mer" }: { fallback?: string }) {
  const t = useTranslations("PageNav");
  const router = useRouter();
  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  };
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-full py-1 pl-1 pr-3 text-sm text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-holo-cyan/60 lg:hidden"
    >
      <IconChevronLeft size={18} />
      {t("back")}
    </button>
  );
}
