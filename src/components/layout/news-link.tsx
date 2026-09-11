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
 *
 * UTSEENDE (ägarbeslut 2026-09-11): på mobilen BARA glyfen — ingen ram, ingen
 * platta, ingen text; träffytan är ändå 44 px. På desktop (lg) samma knapp som
 * Discord hade: ram + etikett. Discord-knappen visas i stället när flödet är
 * dolt (`DiscordLink` gör den spegelvända kollen) — aldrig båda samtidigt.
 */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { newsFeedPublic } from "@/lib/news-feed-gate";
import { IconNews } from "@/components/ui/icons";

export function NewsLink() {
  const t = useTranslations("News");
  // ⛔ Ytan är inte färdig (ägarbeslut 2026-09-09). Knappen är BARA den synliga
  //    vägen dit — sidorna och sitemapen grindas var för sig, se
  //    lib/news-feed-gate.ts. Att bara ta bort knappen hade lämnat URL:en öppen.
  if (!newsFeedPublic()) return null;
  return (
    <Link
      href="/nyheter"
      aria-label={t("headerLink")}
      title={t("headerLink")}
      className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted transition-colors hover:text-ink lg:h-auto lg:w-auto lg:gap-2 lg:border lg:border-surface-border lg:bg-surface-raised lg:px-3.5 lg:py-1.5 lg:hover:border-holo-cyan/50"
    >
      <IconNews size={22} className="shrink-0" />
      <span className="hidden text-sm font-semibold lg:inline">{t("headerLinkShort")}</span>
    </Link>
  );
}
