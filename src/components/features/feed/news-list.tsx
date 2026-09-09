/**
 * "Senaste nytt" — en stor toppost och en tät lista under.
 *
 * ⛔ VARJE RAD FRÅN EN EXTERN KÄLLA GÅR UT TILL KÄLLAN. Vi har ingen egen
 *    artikelsida för dem och ska inte ha en: vi äger inte texten. Rubrik, kort
 *    ingress, källans namn och en länk är hela innehållet.
 * ⛔ VÅRA EGNA POSTER (`internal`) ÄR RAKA MOTSATSEN: de pekar in i appen (ett set,
 *    en produkt) och öppnas i SAMMA vy. En app som slänger ut användaren i en ny
 *    webbläsarflik när hen trycker på vårt eget innehåll känns trasig.
 * ⛔ FILTRERINGEN ÄR KLIENTSIDIG med flit. Ett `?kategori=`-filter hade gjort
 *    sidan dynamisk (en render per besök, ISR-regeln i CLAUDE.md) för att spara
 *    några kilobyte i HTML:en.
 */
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { NEWS_CATEGORIES, type NewsCategory, type NewsItem } from "@/lib/feed";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconExternalLink, IconNews } from "@/components/ui/icons";
import { CategoryPill, FeedCover } from "@/components/features/feed/feed-chrome";

export function NewsList({ items }: { items: NewsItem[] }) {
  const t = useTranslations("News");
  const locale = useLocale();
  const [filter, setFilter] = useState<NewsCategory | "ALL">("ALL");

  // Bara kategorier som FINNS får ett chip. Ett filter som alltid ger noll
  // träffar läser som en bugg.
  const available = useMemo(
    () => NEWS_CATEGORIES.filter((c) => items.some((i) => i.category === c)),
    [items]
  );
  const shown = filter === "ALL" ? items : items.filter((i) => i.category === filter);
  const [hero, ...rest] = shown;

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

      {!hero && (
        <EmptyState icon={<IconNews size={28} />} title={t("emptyNewsTitle")} description={t("emptyNewsBody")} />
      )}

      {hero && (
        <FeedLink item={hero} className="card-surface group overflow-hidden hover:border-holo-cyan/40">
          <FeedCover src={hero.imageUrl} alt="" category={hero.category} className="h-48 sm:h-64">
            <div className="absolute left-3 top-3">
              <CategoryPill category={hero.category} />
            </div>
          </FeedCover>
          <div className="flex flex-col gap-1.5 p-3.5">
            <div className="text-xs tabular-nums text-ink-faint">
              {hero.source} · {formatRelative(hero.publishedAt, locale)}
            </div>
            <h2 className="text-pretty text-xl font-bold leading-tight tracking-[-0.02em] text-ink">{hero.title}</h2>
            {hero.summary && <p className="line-clamp-3 text-pretty text-sm leading-relaxed text-ink-muted">{hero.summary}</p>}
            <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-holo-cyan">
              {hero.internal ? t("openInApp") : t("readAt", { source: hero.source })}
              {!hero.internal && <IconExternalLink size={15} />}
            </span>
          </div>
        </FeedLink>
      )}

      {rest.map((item) => (
        <FeedLink key={item.id} item={item} className="card-surface flex gap-3 p-3 hover:border-holo-cyan/40">
          <FeedCover
            src={item.imageUrl}
            alt=""
            category={item.category}
            className="h-[78px] w-[78px] shrink-0 rounded-[11px] border border-surface-border"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <CategoryPill category={item.category} />
              <span className="truncate text-xs tabular-nums text-ink-faint">
                {item.source} · {formatRelative(item.publishedAt, locale)}
              </span>
            </div>
            <h3 className="line-clamp-2 text-pretty text-[15px] font-semibold leading-snug text-ink">{item.title}</h3>
          </div>
        </FeedLink>
      ))}
    </div>
  );
}

/**
 * Rätt sorts länk för posten. Intern ⇒ `Link` (klientnavigering, samma vy).
 * Extern ⇒ `<a target="_blank" rel="noopener noreferrer">`.
 */
function FeedLink({ item, className, children }: { item: NewsItem; className?: string; children: ReactNode }) {
  if (item.internal) {
    return (
      <Link href={item.url} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
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
