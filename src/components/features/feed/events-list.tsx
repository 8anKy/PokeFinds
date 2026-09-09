/**
 * "Evenemang" — ett utvalt evenemang överst, resten grupperat per månad.
 *
 * ⛔ EVENEMANG HAR EGEN DETALJSIDA, till skillnad från nyheterna: texten där är
 *    VÅR (arrangörens uppgifter sammanfattade), inte en annans artikel.
 * ⛔ INGEN "PÅMINN MIG" (ägarbeslut 2026-09-09). Ett evenemang är ett datum, inte
 *    ett lager som tar slut — och varje påminnelse hade varit ett utskick att
 *    bygga, testa och betala för. Vill man ha det i kalendern finns arrangörens
 *    egen sida bakom knappen.
 */
"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EVENT_CATEGORIES, type EventCategory, type EventItem } from "@/lib/feed";
import { dateLocaleTag } from "@/lib/format";
import { formatEventRange } from "@/lib/event-format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCalendar, IconChevronRight, IconMapPin } from "@/components/ui/icons";
import { CategoryPill, FeedCover } from "@/components/features/feed/feed-chrome";

export function EventsList({ items }: { items: EventItem[] }) {
  const t = useTranslations("News");
  const locale = useLocale();
  const tag = dateLocaleTag(locale);
  const [filter, setFilter] = useState<EventCategory | "ALL">("ALL");

  const available = useMemo(
    () => EVENT_CATEGORIES.filter((c) => items.some((i) => i.category === c)),
    [items]
  );
  const shown = filter === "ALL" ? items : items.filter((i) => i.category === filter);
  const [featured, ...rest] = shown;

  // Månadsrubriker. Listan kommer redan sorterad stigande från byggjobbet, så
  // grupperingen är en enda genomgång — ingen sortering här.
  const months = useMemo(() => {
    const out: { key: string; label: string; items: EventItem[] }[] = [];
    for (const item of rest) {
      const d = new Date(item.startsAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const label = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(d);
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(item);
      else out.push({ key, label, items: [item] });
    }
    return out;
  }, [rest, tag]);

  return (
    <div className="flex flex-col gap-3">
      {available.length > 1 && (
        <div className="-mx-2.5 flex gap-1.5 overflow-x-auto px-2.5 pb-0.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
          <Chip active={filter === "ALL"} onClick={() => setFilter("ALL")}>
            {t("filterAll")}
          </Chip>
          {available.map((c) => (
            <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>
              {t(`cat${c}`)}
            </Chip>
          ))}
        </div>
      )}

      {!featured && (
        <EmptyState icon={<IconCalendar size={28} />} title={t("emptyEventsTitle")} description={t("emptyEventsBody")} />
      )}

      {featured && <FeaturedEvent event={featured} />}

      {months.map((month) => (
        <section key={month.key} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-0.5 pt-2">
            <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-ink">{month.label}</h2>
            <span className="text-xs text-ink-faint">{t("eventCount", { count: month.items.length })}</span>
          </div>
          {month.items.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </section>
      ))}
    </div>
  );
}

function FeaturedEvent({ event }: { event: EventItem }) {
  const t = useTranslations("News");
  const locale = useLocale();
  return (
    <Link href={`/evenemang/${event.slug}`} className="card-surface overflow-hidden hover:border-holo-violet/40">
      <FeedCover src={event.imageUrl} alt="" category={event.category} className="h-44 sm:h-56">
        <div className="absolute left-3 top-3">
          <CategoryPill category={event.category} />
        </div>
      </FeedCover>
      <div className="flex flex-col gap-3 p-3.5">
        <h2 className="text-pretty text-xl font-bold leading-tight tracking-[-0.02em] text-ink">{event.title}</h2>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 text-sm text-ink-muted">
            <IconCalendar size={17} className="shrink-0 text-holo-violet" />
            <span className="tabular-nums">{formatEventRange(event, locale)}</span>
          </div>
          {(event.venue || event.city) && (
            <div className="flex items-center gap-2.5 text-sm text-ink-muted">
              <IconMapPin size={17} className="shrink-0 text-holo-violet" />
              <span className="truncate">{[event.venue, event.city].filter(Boolean).join(" · ")}</span>
            </div>
          )}
        </div>
        <div className="flex h-11 items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface-overlay text-sm font-semibold text-ink">
          {t("readMore")}
          <IconChevronRight size={16} />
        </div>
      </div>
    </Link>
  );
}

function EventRow({ event }: { event: EventItem }) {
  const locale = useLocale();
  const tag = dateLocaleTag(locale);
  const start = new Date(event.startsAt);
  return (
    <Link
      href={`/evenemang/${event.slug}`}
      className="card-surface flex items-center gap-3 py-2.5 pl-2.5 pr-3 hover:border-holo-violet/40"
    >
      <div className="flex w-[42px] shrink-0 flex-col items-center">
        <span className="text-[10px] font-semibold text-ink-faint">
          {new Intl.DateTimeFormat(tag, { weekday: "short" }).format(start).replace(".", "")}
        </span>
        <span className="text-[22px] font-bold leading-none tabular-nums text-ink">{start.getDate()}</span>
      </div>
      <FeedCover
        src={event.imageUrl}
        alt=""
        category={event.category}
        className="h-[52px] w-[52px] shrink-0 rounded-[10px] border border-surface-border"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <CategoryPill category={event.category} className="self-start" />
        <h3 className="truncate text-[15px] font-semibold leading-snug text-ink">{event.title}</h3>
        {(event.city || event.venue) && (
          <span className="flex items-center gap-1 truncate text-xs text-ink-faint">
            <IconMapPin size={12} className="shrink-0" />
            {event.city ?? event.venue}
          </span>
        )}
      </div>
      <IconChevronRight size={18} className="ml-auto shrink-0 text-ink-faint" />
    </Link>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 shrink-0 rounded-full px-3.5 text-[13px] transition-colors duration-150",
        active
          ? "bg-ink font-semibold text-surface"
          : "border border-surface-border bg-surface-overlay font-medium text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
