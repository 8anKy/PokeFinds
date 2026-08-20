import { useTranslations } from "next-intl";
import { DISCORD_URL, INSTAGRAM_URL, TIKTOK_URL } from "@/lib/social-links";
import { IconDiscord, IconInstagram, IconTikTok } from "@/components/ui/brand-icons";
import type { IconProps } from "@/components/ui/icons";

/**
 * Kanalerna i visningsordning (Discord först — det är communityn, inte bara en
 * följ-knapp). Delas med /mer:s "Följ Foilio"-kort så listorna aldrig glider isär.
 * Etiketterna är varumärkesnamn och översätts inte.
 *
 * ⛔ REDDIT ÄR BORTTAGET (ägarbeslut 2026-08-21) och ska inte tillbaka utan att
 * ägaren säger till. `REDDIT_URL` finns kvar i social-links.ts som tombstone —
 * läs kommentaren där innan du länkar dit igen.
 */
export const SOCIAL_CHANNELS: {
  href: string;
  label: string;
  icon: (p: IconProps) => JSX.Element;
}[] = [
  { href: DISCORD_URL, label: "Discord", icon: IconDiscord },
  { href: INSTAGRAM_URL, label: "Instagram", icon: IconInstagram },
  { href: TIKTOK_URL, label: "TikTok", icon: IconTikTok },
];

/**
 * "Häng med oss" — sociala kanaler under filterpanelen i katalogens desktop-
 * sidofält (ägarens placering 2026-08-11: sidfoten ser nästan ingen, sidofältet
 * står bredvid varje sökresultat). Monokroma glyfer — brandfärger hade krävt
 * hårdkodade hex utanför tokensystemet.
 */
export function JoinUsCard() {
  const t = useTranslations("JoinUs");
  return (
    <div className="card-surface overflow-hidden">
      <p className="border-b border-surface-border/60 px-4 py-3.5 text-sm font-semibold text-ink">
        {t("title")}
      </p>
      <nav className="flex flex-col py-1">
        {SOCIAL_CHANNELS.map((c) => (
          <a
            key={c.label}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-overlay/50 hover:text-ink"
          >
            <c.icon size={18} className="shrink-0" />
            {c.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
