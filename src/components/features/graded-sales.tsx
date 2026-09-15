"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatPrice, dateLocaleTag } from "@/lib/format";
import { ISSUER_LABELS, formatGrade, type GradingIssuer } from "@/lib/graded-listing";
import type { GradedAskRow, GradedSaleRow, GradedSummary } from "@/services/graded";
import { cn } from "@/lib/utils";

/**
 * GRADERADE PRISER — ett block, en rad per (bolag, betyg), två kolumner:
 * TILL SALU (eBay, lägsta begärda) och SÅLT (Tradera, median). Förr två
 * tabeller under varandra; läsaren letar efter SITT betyg och vill se båda
 * talen på samma rad (ägaren 2026-09-15).
 *
 * ⛔ BEGÄRT ÄR INTE SÅLT. Kolumnerna har egna rubriker, egen källa i varje
 * cell och blandas aldrig i ett tal. En rad med bara ena talet visar "–" i den
 * andra — aldrig ett lånat värde.
 * ⛔ ANTALET STÅR ALLTID BREDVID PRISET (annonser resp. affärer). Underlaget
 * är tunt av naturen (~128 sålda slabbar/dygn i hela Sverige); ett pris utan
 * sitt urval låtsas vara en marknad.
 * ⛔ INGET SNITT ÖVER BETYG. PSA 10 och PSA 6 är olika varor.
 * ⛔ INGEN SEKTION UTAN DATA. Tomt → null; serien byggs framåt.
 * ⛔ Tabellen scrollar aldrig sidled: raden är ett CSS-grid som får plats på
 *    375 px (betyg 3,25 rem + två lika kolumner).
 */
export function GradedSales({
  graded,
  productTitle,
}: {
  graded: GradedSummary | undefined;
  productTitle: string;
}) {
  const t = useTranslations("Detail");
  const locale = useLocale();
  const asks = graded?.asks ?? [];
  const sales = graded?.rows ?? [];
  if (!graded || (sales.length === 0 && asks.length === 0)) return null;

  const dateFmt = new Intl.DateTimeFormat(dateLocaleTag(locale), { day: "numeric", month: "short" });
  const groups = mergeGraded(asks, sales);
  const hasAsks = asks.length > 0;
  const hasSales = sales.length > 0;

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl font-semibold text-ink">{t("gradedPricesTitle")}</h2>
        <span className="text-sm text-ink-muted">
          {hasAsks && hasSales
            ? t("gradedPricesSubtitleBoth")
            : hasAsks
              ? t("gradedPricesSubtitleAsks")
              : t("gradedSubtitle", { count: graded.totalSales })}
        </span>
      </div>

      <div className="card-surface mt-4 overflow-hidden">
        {/* Kolumnrubriker — källan står i rubriken, inte bara i sidfoten. */}
        <div className="grid grid-cols-[3.25rem_1fr_1fr] gap-x-3 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-ink-muted sm:px-4">
          <span>{t("gradedColGrade")}</span>
          <span>{t("gradedAskLabel")} · eBay</span>
          <span>{t("gradedSoldLabel")} · Tradera</span>
        </div>

        {groups.map((g) => (
          <div key={g.issuer}>
            <div className="bg-surface-overlay/40 px-3 py-1.5 text-xs font-semibold text-ink sm:px-4">
              {ISSUER_LABELS[g.issuer] ?? g.issuer}
            </div>
            {g.rows.map((r) => (
              <div
                key={`${g.issuer}-${r.gradeTenths ?? "x"}`}
                className="grid grid-cols-[3.25rem_1fr_1fr] items-start gap-x-3 border-b border-line/60 px-3 py-3 last:border-0 sm:px-4"
              >
                {/* Betyget: stort tal — det är vad läsaren skannar efter. Okänt = "–". */}
                <div className="font-display text-lg font-semibold leading-none text-ink">
                  {r.gradeTenths == null ? "–" : formatGrade(r.gradeTenths)}
                </div>

                {/* TILL SALU: lägsta begärda, länk till annonsen, antal + originalvaluta. */}
                {r.ask ? (
                  <div className="min-w-0">
                    <a
                      href={r.ask.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="block truncate text-sm font-semibold text-holo-cyan hover:underline"
                    >
                      {formatPrice(r.ask.priceOre)}
                    </a>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                      {t("gradedAskListingCount", { count: r.ask.listingCount })}
                      {r.ask.originalCurrency !== "SEK" && (
                        <> · {(r.ask.originalMinor / 100).toFixed(0)} {r.ask.originalCurrency}</>
                      )}
                    </p>
                  </div>
                ) : (
                  <Empty />
                )}

                {/* SÅLT: median + antal, senaste affären som länk. */}
                {r.sale ? (
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{formatPrice(r.sale.medianOre)}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                      {t("gradedSampleCount", { count: r.sale.count })}
                      {" · "}
                      <a
                        href={r.sale.lastUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-holo-cyan hover:underline"
                      >
                        {t("gradedLastSold", {
                          price: formatPrice(r.sale.lastPriceOre),
                          date: dateFmt.format(new Date(r.sale.lastSoldAt)),
                        })}
                      </a>
                    </p>
                  </div>
                ) : (
                  <Empty />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ⛔ Källorna och deras gränser står UT, inte i en tooltip. Begärt är inte
          betalt, kursen är dagens, frakt/tull tillkommer; sålt är Tradera-slut-
          priser, och en enstaka affär är inget marknadspris. */}
      <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-ink-muted">
        {hasAsks && <p>{t("gradedAskFootnote")}</p>}
        {hasSales && <p>{t("gradedFootnote", { title: productTitle })}</p>}
      </div>
    </section>
  );
}

function Empty() {
  return <span className={cn("text-sm text-ink-faint")}>–</span>;
}

interface MergedRow {
  gradeTenths: number | null;
  ask: GradedAskRow | null;
  sale: GradedSaleRow | null;
}

const ISSUER_ORDER: GradingIssuer[] = [
  "PSA", "BGS", "CGC", "SGC", "ACE", "RAUKCARD", "TAG", "HGA", "GMA", "ISA", "AGS", "GG", "OTHER",
];

/**
 * Slår ihop begärt (eBay) och sålt (Tradera) till en rad per (bolag, betyg).
 * Bolagen i samma ordning som tjänsten (stora först, OTHER sist), betygen
 * fallande — raden folk letar efter ligger överst.
 */
export function mergeGraded(asks: GradedAskRow[], sales: GradedSaleRow[]): { issuer: GradingIssuer; rows: MergedRow[] }[] {
  const byIssuer = new Map<GradingIssuer, Map<string, MergedRow>>();
  const rowFor = (issuer: GradingIssuer, gradeTenths: number | null) => {
    let grades = byIssuer.get(issuer);
    if (!grades) byIssuer.set(issuer, (grades = new Map()));
    const key = gradeTenths == null ? "x" : String(gradeTenths);
    let row = grades.get(key);
    if (!row) grades.set(key, (row = { gradeTenths, ask: null, sale: null }));
    return row;
  };
  for (const a of asks) rowFor(a.issuer, a.gradeTenths).ask = a;
  for (const s of sales) rowFor(s.issuer, s.gradeTenths).sale = s;
  return [...byIssuer.entries()]
    .sort(([a], [b]) => ISSUER_ORDER.indexOf(a) - ISSUER_ORDER.indexOf(b))
    .map(([issuer, grades]) => ({
      issuer,
      rows: [...grades.values()].sort((a, b) => (b.gradeTenths ?? -1) - (a.gradeTenths ?? -1)),
    }));
}
