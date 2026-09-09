/**
 * Flödets gemensamma delar: lägesväxlaren (Nyheter / Evenemang), kategoripillret
 * och omslagsbilden.
 *
 * ⛔ EN VÄXLARE, TVÅ RUTTER. Lägena är riktiga sidor (`/nyheter`, `/evenemang`)
 *    och inte en query-parameter: en parameter hade gjort sidan dynamisk och
 *    därmed kostat en render per besök (ISR-regeln i CLAUDE.md). Två rutter är
 *    dessutom delbara länkar och egna poster i sitemapen.
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { EventCategory, NewsCategory } from "@/lib/feed";

export function FeedSwitch({ active }: { active: "news" | "events" }) {
  const t = useTranslations("News");
  const item = "flex flex-1 items-center justify-center rounded-full text-sm font-medium transition-colors duration-150 h-[38px]";
  const on = "bg-holo-cyan/12 text-holo-cyan font-semibold ring-1 ring-inset ring-holo-cyan/35";
  const off = "text-ink-muted hover:text-ink";
  return (
    <div className="flex gap-1 rounded-full border border-surface-border bg-black/40 p-1">
      <Link href="/nyheter" className={cn(item, active === "news" ? on : off)} aria-current={active === "news" ? "page" : undefined}>
        {t("tabNews")}
      </Link>
      <Link href="/evenemang" className={cn(item, active === "events" ? on : off)} aria-current={active === "events" ? "page" : undefined}>
        {t("tabEvents")}
      </Link>
    </div>
  );
}

/**
 * Kategorifärgerna. ⛔ Tokens, aldrig hex: teal = något som SLÄPPS, gult =
 * marknad/pengar (samma familj som `holo.gold` i prisytorna), violett = möten
 * mellan människor (samma som community). Färgen är alltså inte dekor utan
 * samma betydelse som på resten av sajten.
 */
const PILL: Record<NewsCategory | EventCategory, string> = {
  RELEASE: "bg-holo-cyan/12 text-holo-cyan ring-holo-cyan/30",
  MARKET: "bg-holo-gold/12 text-holo-gold ring-holo-gold/30",
  STORE: "bg-holo-violet/12 text-holo-violet ring-holo-violet/30",
  EXPO: "bg-holo-violet/12 text-holo-violet ring-holo-violet/30",
  PRERELEASE: "bg-holo-cyan/12 text-holo-cyan ring-holo-cyan/30",
  TOURNAMENT: "bg-holo-gold/12 text-holo-gold ring-holo-gold/30",
  OTHER: "bg-surface-overlay text-ink-muted ring-surface-border",
};

export function CategoryPill({
  category,
  className,
}: {
  category: NewsCategory | EventCategory;
  className?: string;
}) {
  const t = useTranslations("News");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset",
        PILL[category],
        className
      )}
    >
      {t(`cat${category}`)}
    </span>
  );
}

/**
 * Omslaget. Bilden HOTLÄNKAS från källan (vi sparar aldrig andras bilder) och
 * kan därför försvinna när som helst — hotlink-skydd, borttagen artikel, HTTP
 * mot vår HTTPS. ⛔ Därför ligger en tonad platta i kategorifärgen UNDER bilden,
 * alltid: går hämtningen fel tas `<img>` bort och plattan blir omslaget. En
 * trasig bildikon mitt i listan läser som att appen är sönder.
 */
const TINT: Record<NewsCategory | EventCategory, string> = {
  RELEASE: "from-holo-cyan/25",
  MARKET: "from-holo-gold/25",
  STORE: "from-holo-violet/25",
  EXPO: "from-holo-violet/25",
  PRERELEASE: "from-holo-cyan/25",
  TOURNAMENT: "from-holo-gold/25",
  OTHER: "from-ink/10",
};

export function FeedCover({
  src,
  alt,
  category,
  className,
  children,
}: {
  src: string | null;
  alt: string;
  category: NewsCategory | EventCategory;
  className?: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-gradient-to-br to-black",
        TINT[category],
        className
      )}
    >
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- extern bild från källan; next/image hade krävt remotePatterns per domän och optimerat andras bilder på vår CPU.
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {children}
    </div>
  );
}
