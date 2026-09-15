"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { formatPrice } from "@/lib/format";
import { ISSUER_LABELS, formatGrade, type GradingIssuer } from "@/lib/graded-listing";
import { buildGradedCards, defaultGrade, type GradedGradeCell, type GradedIssuerCard } from "@/lib/graded-merge";
import type { GradedSummary } from "@/services/graded";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SafeImage } from "@/components/ui/safe-image";
import { IconChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface GradedSelection {
  issuer: GradingIssuer;
  gradeTenths: number;
}

/**
 * GRADERINGSBADGARNA (ägaren 2026-09-15, v2 — "för bulkigt" om v1): en låg rad
 * under grafen. Första badgen "Ograderad" (prislistans pris), sedan en per bolag:
 * bolagets märke · [betyg ▾] · priset för det betyget. Tryck på badgen ⇒ grafen
 * byter till det betyget; tryck på betyget ⇒ ett ark glider upp med bolagets
 * alla betyg och priser att välja ur.
 *
 * ⛔ PRISET I BADGEN ÄR LÄGSTA BEGÄRDA (eBay) för betyget — saknas det visas
 *    Tradera-medianen med etiketten "sålt", aldrig ett omärkt tal. Arket visar
 *    båda källorna per betyg, sida vid sida.
 * ⛔ MÄRKENA ÄR IDENTIFIERARE vid bolagets EGNA priser (referensbruk, samma regel
 *    som butiksloggorna). Filen `public/grading-logos/<issuer>.svg` ritas om den
 *    finns, annars ett ordmärke i text — ingen logotyp hittas på.
 * ⛔ Ingen rad utan data — tomt → null. Rälsen bleeder med sidans gutter.
 */
export function GradedCarousel({
  graded,
  rawPriceOre,
  selected,
  onSelect,
}: {
  graded: GradedSummary | undefined;
  /** Prislistans pris (lägsta köpbara) för "Ograderad"-badgen; null = "–". */
  rawPriceOre: number | null;
  selected: GradedSelection | null;
  onSelect: (sel: GradedSelection | null) => void;
}) {
  const t = useTranslations("Detail");
  const cards = useMemo(
    () => buildGradedCards(graded?.asks ?? [], graded?.rows ?? [], graded?.history ?? []),
    [graded]
  );
  // Aktivt betyg per bolag — badgen minns sitt betyg även när ett annat bolag är
  // valt i grafen.
  const [active, setActive] = useState<Record<string, number>>({});
  const [sheetFor, setSheetFor] = useState<GradedIssuerCard | null>(null);
  if (cards.length === 0) return null;

  const gradeOf = (card: GradedIssuerCard) => active[card.issuer] ?? defaultGrade(card);
  const cellOf = (card: GradedIssuerCard) =>
    card.grades.find((g) => g.gradeTenths === gradeOf(card)) ?? card.grades[0];

  return (
    <div className="mt-4">
      {/* data-swipe-ignore: rälsen äger sitt vågräta drag — utan den tolkar
          produkt-overlayn svepet som "tillbaka" (samma som Tradera-skenan). */}
      <div
        data-swipe-ignore
        className="-mx-2.5 flex snap-x gap-2 overflow-x-auto px-2.5 pb-1 lg:mx-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={t("gradedPricesTitle")}
      >
        <Badge selected={selected === null} onClick={() => onSelect(null)}>
          <span className="text-[11px] font-semibold text-ink">{t("gradedRawCard")}</span>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {rawPriceOre != null ? formatPrice(rawPriceOre) : "–"}
          </span>
        </Badge>

        {cards.map((card) => {
          const cell = cellOf(card);
          const isSel = selected?.issuer === card.issuer && selected.gradeTenths === cell.gradeTenths;
          return (
            <Badge
              key={card.issuer}
              selected={isSel}
              onClick={() => onSelect({ issuer: card.issuer, gradeTenths: cell.gradeTenths })}
            >
              <span className="flex items-center gap-1.5">
                <IssuerMark issuer={card.issuer} />
                {/* Betygsväljaren: egen knapp inne i badgen ⇒ arket. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSheetFor(card);
                  }}
                  aria-label={t("gradedPickGrade", { issuer: ISSUER_LABELS[card.issuer] ?? card.issuer })}
                  className="flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
                >
                  {formatGrade(cell.gradeTenths)}
                  <IconChevronDown size={11} className="text-ink-muted" />
                </button>
              </span>
              <CellPrice cell={cell} />
            </Badge>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">{t("gradedCarouselHint")}</p>

      {/* Arket: bolagets alla betyg, båda källorna per rad. */}
      <BottomSheet
        open={sheetFor !== null}
        title={sheetFor ? `${ISSUER_LABELS[sheetFor.issuer] ?? sheetFor.issuer} · ${t("gradedColGrade")}` : ""}
        onClose={() => setSheetFor(null)}
        closeLabel={t("watchSheetClose")}
        panelClassName="sm:mx-auto sm:max-w-md"
      >
        {sheetFor && (
          // Bottenluft + safe-area: sista raden låg under skärmkanten på iPhone.
          <div className="flex flex-col gap-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {sheetFor.grades.map((g) => {
              const on = g.gradeTenths === gradeOf(sheetFor);
              return (
                <button
                  key={g.gradeTenths}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setActive((prev) => ({ ...prev, [sheetFor.issuer]: g.gradeTenths }));
                    onSelect({ issuer: sheetFor.issuer, gradeTenths: g.gradeTenths });
                    setSheetFor(null);
                  }}
                  className={cn(
                    "grid grid-cols-[3rem_1fr_1fr] items-center gap-x-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    on ? "border-holo-cyan bg-holo-cyan/10" : "border-surface-border bg-surface hover:border-surface-border/80"
                  )}
                >
                  <span className="font-display text-lg font-semibold text-ink">{formatGrade(g.gradeTenths)}</span>
                  <span className="min-w-0">
                    {g.ask ? (
                      <>
                        <span className="block text-sm font-semibold text-holo-cyan">{formatPrice(g.ask.priceOre)}</span>
                        <span className="block text-[11px] text-ink-muted">
                          {t("gradedAskListingCount", { count: g.ask.listingCount })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-ink-faint">–</span>
                    )}
                  </span>
                  <span className="min-w-0">
                    {g.sale ? (
                      <>
                        <span className="block text-sm font-semibold text-ink">{formatPrice(g.sale.medianOre)}</span>
                        <span className="block text-[11px] text-ink-muted">
                          {t("gradedSampleCount", { count: g.sale.count })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-ink-faint">–</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function Badge({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "flex h-14 shrink-0 snap-start cursor-pointer flex-col justify-between rounded-xl border px-3 py-2 transition-colors",
        selected ? "border-holo-cyan bg-holo-cyan/10" : "border-surface-border bg-surface hover:border-surface-border/80"
      )}
    >
      {children}
    </div>
  );
}

/** Badgens pris: begärt (eBay) i första hand, annars sålt-medianen MÄRKT. */
function CellPrice({ cell }: { cell: GradedGradeCell }) {
  const t = useTranslations("Detail");
  if (cell.ask) {
    return <span className="text-sm font-semibold tabular-nums text-ink">{formatPrice(cell.ask.priceOre)}</span>;
  }
  if (cell.sale) {
    return (
      <span className="text-sm font-semibold tabular-nums text-ink">
        {formatPrice(cell.sale.medianOre)}
        <span className="ml-1 text-[10px] font-normal uppercase text-ink-muted">{t("gradedSoldLabel")}</span>
      </span>
    );
  }
  return <span className="text-sm text-ink-faint">–</span>;
}

/**
 * Bolagens märken som FINNS som fil (public/grading-logos/, hämtade 2026-09-15 ur
 * bolagens egna sajter — referensbruk vid deras egna priser). Övriga får ett
 * ordmärke i text; listan hindrar en 404-begäran per okänt bolag och sida.
 */
const LOGO_FILES: Partial<Record<GradingIssuer, string>> = {
  PSA: "/grading-logos/psa.svg",
  TAG: "/grading-logos/tag.png",
  RAUKCARD: "/grading-logos/raukcard.svg",
};

/** Bolagets märke: filen om den finns, annars ett ordmärke. Höjd 14 px, bredd fri. */
function IssuerMark({ issuer }: { issuer: GradingIssuer }) {
  const label = ISSUER_LABELS[issuer] ?? issuer;
  const wordmark = <span className="font-display text-[11px] font-black uppercase tracking-wide text-ink">{label}</span>;
  const src = LOGO_FILES[issuer];
  if (!src) return wordmark;
  return <SafeImage src={src} alt={label} className="h-3.5 w-auto max-w-[4.5rem] object-contain" fallback={wordmark} />;
}
