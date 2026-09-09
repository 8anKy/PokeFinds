/**
 * Nyhetsknappen i headern, bredvid kontoknappen.
 *
 * ⛔ DEN ERSATTE DISCORD-KNAPPEN (ägarbeslut 2026-09-09). Discord nås fortfarande
 *    från /mer och sidfoten; headern har plats för EN sak bredvid kontot, och
 *    flödet är det enda som ändrar sig varje dag. Två ikoner där hade gjort raden
 *    till en verktygsrad — samma skäl som `SubpageHeader` bara tillåter en åtgärd.
 *
 * ⛔ INGEN `auth()`, ingen `cookies()`, ingen databas: knappen ligger i headern
 *    som renderas i rot-nära layouter, och allt sådant hade gjort HELA appen
 *    dynamisk (ISR-regeln i CLAUDE.md).
 */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconNews } from "@/components/ui/icons";

export function NewsLink() {
  const t = useTranslations("News");
  return (
    <Link
      href="/nyheter"
      aria-label={t("headerLink")}
      title={t("headerLink")}
      className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-2.5 py-1.5 text-ink-muted transition-colors hover:border-holo-cyan/50 hover:text-ink lg:px-3.5"
    >
      <IconNews size={20} className="shrink-0" />
      <span className="hidden text-sm font-semibold lg:inline">{t("headerLinkShort")}</span>
    </Link>
  );
}
