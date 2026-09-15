"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatPrice, dateLocaleTag } from "@/lib/format";
import { ISSUER_LABELS, formatGrade } from "@/lib/graded-listing";
import { buildGradedCards, defaultGrade, type GradedIssuerCard } from "@/lib/graded-merge";
import type { GradedSummary } from "@/services/graded";
import { cn } from "@/lib/utils";

export interface GradedSelection {
  issuer: GradedIssuerCard["issuer"];
  gradeTenths: number;
}

/**
 * GRADERINGSKARUSELLEN (ägarbeslut 2026-09-15) — under grafen, ovanför butikerna.
 *
 * Första kortet är "Ograderad" (grafen som förut); sedan ett kort per bolag
 * med betygschips. Ett tryck på ett chip väljer (bolag, betyg): kortet visar
 * TILL SALU (eBay, lägsta begärda, länk) och SÅLT (Tradera, median) för det
 * betyget, och grafen ovanför byter till "PSA 10 · prishistorik". Karusellen
 * ÄR alltså grafens graderingsväljare — inget separat block, ingen lodrät lista.
 *
 * ⛔ BEGÄRT ÄR INTE SÅLT: två rader med egen etikett och källa, aldrig ett tal.
 * ⛔ Antalet står alltid bredvid priset (annonser resp. affärer).
 * ⛔ Ingen karusell utan data — tomt → null.
 * ⛔ Rälsen bleeder till kanten med sidans gutter (-mx-2.5 px-2.5, ui-shell.md).
 */
export function GradedCarousel({
  graded,
  selected,
  onSelect,
}: {
  graded: GradedSummary | undefined;
  selected: GradedSelection | null;
  onSelect: (sel: GradedSelection | null) => void;
}) {
  const t = useTranslations("Detail");
  const locale = useLocale();
  const cards = useMemo(
    () => buildGradedCards(graded?.asks ?? [], graded?.rows ?? [], graded?.history ?? []),
    [graded]
  );
  // Aktivt betyg per kort (lokalt) — kortet får minnas sitt betyg även när ett
  // annat kort är valt i grafen.
  const [active, setActive] = useState<Record<string, number>>({});
  if (cards.length === 0) return null;

  const dateFmt = new Intl.DateTimeFormat(dateLocaleTag(locale), { day: "numeric", month: "short" });

  return (
    <section className="mt-5" aria-label={t("gradedPricesTitle")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{t("gradedPricesTitle")}</h2>
        <span className="text-xs text-ink-muted">{t("gradedCarouselHint")}</span>
      </div>
      <div className="-mx-2.5 mt-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-2.5 pb-1 lg:mx-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Ograderad — tillbaka till den vanliga kurvan. */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          className={cn(
            "flex w-[8.5rem] shrink-0 snap-start flex-col items-start justify-between rounded-2xl border p-3 text-left transition-colors",
            selected === null ? "border-holo-cyan bg-holo-cyan/10" : "border-surface-border bg-surface hover:border-surface-border/80"
          )}
        >
          <span className="text-sm font-semibold text-ink">{t("gradedRawCard")}</span>
          <span className="mt-3 text-[11px] leading-snug text-ink-muted">{t("gradedRawCardHint")}</span>
        </button>

        {cards.map((card) => {
          const grade = active[card.issuer] ?? defaultGrade(card);
          const cellFor = card.grades.find((g) => g.gradeTenths === grade) ?? card.grades[0];
          const isSelected = selected?.issuer === card.issuer && selected.gradeTenths === cellFor.gradeTenths;
          return (
            <div
              key={card.issuer}
              className={cn(
                "w-[15.5rem] shrink-0 snap-start rounded-2xl border p-3 transition-colors",
                isSelected ? "border-holo-cyan bg-holo-cyan/10" : "border-surface-border bg-surface"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{ISSUER_LABELS[card.issuer] ?? card.issuer}</span>
                {isSelected && <span className="text-[10px] font-semibold uppercase tracking-wide text-holo-cyan">{t("gradedInChart")}</span>}
              </div>

              {/* Betygschips: ett tryck väljer betyget OCH sätter grafen. */}
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("gradedColGrade")}>
                {card.grades.map((g) => {
                  const on = g.gradeTenths === cellFor.gradeTenths;
                  return (
                    <button
                      key={g.gradeTenths}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setActive((prev) => ({ ...prev, [card.issuer]: g.gradeTenths }));
                        onSelect({ issuer: card.issuer, gradeTenths: g.gradeTenths });
                      }}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors",
                        on
                          ? "border-holo-cyan bg-holo-cyan text-surface"
                          : "border-surface-border text-ink-muted hover:text-ink"
                      )}
                    >
                      {formatGrade(g.gradeTenths)}
                    </button>
                  );
                })}
              </div>

              {/* Två rader, två källor — aldrig ett tal. */}
              <dl className="mt-3 grid grid-cols-2 gap-x-3">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-ink-muted">{t("gradedAskLabel")} · eBay</dt>
                  <dd className="mt-0.5">
                    {cellFor.ask ? (
                      <>
                        <a
                          href={cellFor.ask.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="block truncate text-sm font-semibold text-holo-cyan hover:underline"
                        >
                          {formatPrice(cellFor.ask.priceOre)}
                        </a>
                        <span className="block text-[11px] text-ink-muted">
                          {t("gradedAskListingCount", { count: cellFor.ask.listingCount })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-ink-faint">–</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-ink-muted">{t("gradedSoldLabel")} · Tradera</dt>
                  <dd className="mt-0.5">
                    {cellFor.sale ? (
                      <>
                        <span className="block text-sm font-semibold text-ink">{formatPrice(cellFor.sale.medianOre)}</span>
                        <a
                          href={cellFor.sale.lastUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="block truncate text-[11px] text-ink-muted hover:text-holo-cyan"
                        >
                          {t("gradedSampleCount", { count: cellFor.sale.count })} ·{" "}
                          {dateFmt.format(new Date(cellFor.sale.lastSoldAt))}
                        </a>
                      </>
                    ) : (
                      <span className="text-sm text-ink-faint">–</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
