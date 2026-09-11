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
import {
  IconCalendar,
  IconCards,
  IconNews,
  IconSparkle,
  IconStore,
  IconTrendingUp,
  IconTrophy,
  type IconProps,
} from "@/components/ui/icons";

export function FeedSwitch({
  active,
  onChange,
}: {
  active: "news" | "events";
  /** En inbäddad mobilväxlare behåller båda ISR-lägena i samma vy. */
  onChange?: (next: "news" | "events") => void;
}) {
  const t = useTranslations("News");
  const item = "flex flex-1 items-center justify-center rounded-full text-sm font-medium transition-colors duration-150 h-[38px]";
  const on = "bg-holo-cyan/12 text-holo-cyan font-semibold ring-1 ring-inset ring-holo-cyan/35";
  const off = "text-ink-muted hover:text-ink";
  return (
    <div className="flex gap-1 rounded-full border border-surface-border bg-black/40 p-1">
      {onChange ? (
        <>
          <button type="button" onClick={() => onChange("news")} className={cn(item, active === "news" ? on : off)} aria-pressed={active === "news"}>
            {t("tabNews")}
          </button>
          <button type="button" onClick={() => onChange("events")} className={cn(item, active === "events" ? on : off)} aria-pressed={active === "events"}>
            {t("tabEvents")}
          </button>
        </>
      ) : (
        <>
          <Link href="/nyheter" className={cn(item, active === "news" ? on : off)} aria-current={active === "news" ? "page" : undefined}>
            {t("tabNews")}
          </Link>
          <Link href="/evenemang" className={cn(item, active === "events" ? on : off)} aria-current={active === "events" ? "page" : undefined}>
            {t("tabEvents")}
          </Link>
        </>
      )}
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
  RELEASE: "bg-holo-violet/12 text-holo-violet ring-holo-violet/30",
  MARKET: "bg-holo-gold/12 text-holo-gold ring-holo-gold/30",
  STORE: "bg-holo-pink/12 text-holo-pink ring-holo-pink/30",
  // ⛔ Vår EGEN nyhet bär märkesfärgen — och därför flyttades setsläppen till
  //    violett: de två låg annars i samma teal i samma lista. Färgerna måste
  //    stämma med `ACCENT` i scripts/make-feed-cover.ts, som ritar omslagen.
  APP: "bg-holo-cyan/12 text-holo-cyan ring-holo-cyan/30",
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
  RELEASE: "from-holo-violet/25",
  MARKET: "from-holo-gold/25",
  STORE: "from-holo-pink/25",
  APP: "from-holo-cyan/25",
  EXPO: "from-holo-violet/25",
  PRERELEASE: "from-holo-cyan/25",
  TOURNAMENT: "from-holo-gold/25",
  OTHER: "from-ink/10",
};

/**
 * Vad som målas när posten SAKNAR omslag. ⛔ Alla källor har inte en bild att
 * hotlänka — pokemon.com renderar sin og:image med JS och psacard.com svarar 403
 * på vår bot (mätt 2026-09-09) — och en tom platta bredvid rader som har bild
 * läser som ett fel. Kategorins egen ikon som vattenstämpel gör frånvaron till
 * ett medvetet uttryck i stället.
 */
const FALLBACK_ICON: Record<NewsCategory | EventCategory, (p: IconProps) => JSX.Element> = {
  RELEASE: IconCards,
  MARKET: IconTrendingUp,
  STORE: IconStore,
  APP: IconSparkle,
  EXPO: IconCalendar,
  PRERELEASE: IconCards,
  TOURNAMENT: IconTrophy,
  OTHER: IconNews,
};

export function FeedCover({
  src,
  alt,
  category,
  fit = "cover",
  className,
  children,
}: {
  src: string | null;
  alt: string;
  category: NewsCategory | EventCategory;
  /** `contain` för logotyper — se `imageFit` i src/lib/feed.ts. */
  fit?: "cover" | "contain";
  className?: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const Fallback = FALLBACK_ICON[category];
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
          className={cn(
            "absolute inset-0 h-full w-full",
            // `contain` får luft: en logga som går ut i kanten läser som beskuren
            // även när den inte är det.
            fit === "contain" ? "object-contain p-[12%]" : "object-cover"
          )}
        />
      )}
      {(!src || failed) && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Fallback className="h-[42%] max-h-16 w-auto text-ink/25" />
        </div>
      )}
      {children}
    </div>
  );
}
