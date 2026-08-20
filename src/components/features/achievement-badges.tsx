/**
 * Utmärkelser som chip-rad. Presentationell — tar färdiga rader som props och
 * gör inga anrop.
 *
 * ⛔ IKONEN ÄR EN STRÄNG I KATALOGEN. `src/lib/achievements.ts` måste vara fri
 * från JSX för att kunna testas utan React och läsas av nattjobbet; uppslaget
 * från namn till komponent hör därför hemma här, i renderande kod.
 *
 * ⛔ En okänd ikonsträng ritar INGEN ikon i stället för att krascha raden: en
 * utmärkelse som användaren låst upp ska visas även om någon stavat fel i
 * katalogen, och `undefined` som JSX-taggnamn kastar.
 */
import type { JSX } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  IconBell,
  IconCamera,
  IconCards,
  IconCheck,
  IconGem,
  IconGift,
  IconMessage,
  IconPackage,
  IconReceipt,
  IconScan,
  IconShield,
  IconTrendingDown,
  IconTrendingUp,
  IconTrophy,
  type IconProps,
} from "@/components/ui/icons";
import type { UserAchievementView } from "@/services/achievements";

export const ACHIEVEMENT_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  IconBell,
  IconCamera,
  IconCards,
  IconCheck,
  IconGem,
  IconGift,
  IconMessage,
  IconPackage,
  IconReceipt,
  IconScan,
  IconShield,
  IconTrendingDown,
  IconTrendingUp,
  IconTrophy,
};

export function AchievementBadges({
  achievements,
  showTier = true,
}: {
  achievements: UserAchievementView[];
  showTier?: boolean;
}) {
  const t = useTranslations("Achievements");
  if (achievements.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {achievements.map((a) => {
        const Icon = ACHIEVEMENT_ICONS[a.icon];
        return (
          <li key={a.id}>
            <Badge
              variant={a.variant}
              className="inline-flex items-center gap-1.5"
              title={t(`${a.key}.desc`, { count: a.threshold })}
            >
              {Icon ? <Icon size={13} aria-hidden="true" /> : null}
              {t(`${a.key}.name`)}
              {showTier && a.tiered && (
                <span className="opacity-60">· {t("tierLabel", { tier: a.tier })}</span>
              )}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
