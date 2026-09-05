"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatPrice, dateLocaleTag } from "@/lib/format";
import { ISSUER_LABELS, formatGrade, type GradingIssuer } from "@/lib/graded-listing";
import type { GradedSummary } from "@/services/graded";

/**
 * GRADERADE FÖRSÄLJNINGAR — en EGEN sektion, aldrig en rad i pristabellen.
 *
 * ⛔ ANTALET AFFÄRER STÅR ALLTID BREDVID PRISET. Underlaget är tunt av naturen:
 * hela Sverige avslutar ~128 graderade Pokémon-annonser per dygn (mätt
 * 2026-09-04) mot ~20 000 singlar i katalogen. De flesta rader blir n=1–2. Ett
 * pris utan sitt urval låtsas vara en marknad — och det är precis den lögnen
 * "–"-doktrinen finns för att undvika.
 *
 * ⛔ INGET SNITT ÖVER BETYG. En PSA 10 och en PSA 6 är olika varor.
 *
 * ⛔ INGEN RAD UTAN AFFÄRER. Tomt `rows` → sektionen finns inte. Serien byggs
 * framåt och börjar tom; en tabell med bara streck vore sämre än ingen tabell.
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
  if (!graded || graded.rows.length === 0) return null;

  const dateFmt = new Intl.DateTimeFormat(dateLocaleTag(locale), { day: "numeric", month: "short" });

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl font-semibold text-ink">{t("gradedTitle")}</h2>
        <span className="text-sm text-ink-muted">
          {t("gradedSubtitle", { count: graded.totalSales })}
        </span>
      </div>

      {/* Bred tabell scrollar i SIN EGEN behållare — sidan får aldrig scrolla i sidled. */}
      <div className="card-surface mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-3 font-medium">{t("gradedColGrade")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("gradedColMedian")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("gradedColRange")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("gradedColLast")}</th>
            </tr>
          </thead>
          <tbody>
            {graded.rows.map((r) => (
              <tr
                key={`${r.issuer}-${r.gradeTenths ?? "x"}`}
                className="border-b border-line/60 last:border-0"
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">
                    {ISSUER_LABELS[r.issuer as GradingIssuer] ?? r.issuer}
                  </span>{" "}
                  {/* ⛔ Okänt betyg visas som "–", ALDRIG som 0. */}
                  <span className="text-ink-muted">
                    {r.gradeTenths == null ? "–" : formatGrade(r.gradeTenths)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-semibold text-ink">{formatPrice(r.medianOre)}</span>
                  {/* Urvalet, alltid synligt. */}
                  <span className="ml-2 text-xs text-ink-muted">
                    {t("gradedSampleCount", { count: r.count })}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-ink-muted">
                  {r.count > 1 ? `${formatPrice(r.lowOre)}–${formatPrice(r.highOre)}` : "–"}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={r.lastUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-holo-cyan hover:underline"
                  >
                    {formatPrice(r.lastPriceOre)}
                  </a>
                  <span className="ml-2 text-xs text-ink-muted">
                    {dateFmt.format(new Date(r.lastSoldAt))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ⛔ Källan och dess gränser står UT, inte i en tooltip: det är sålda
          Tradera-affärer, inte en prislista, och en enstaka affär är inte ett
          marknadspris. Samma ärlighetskrav som på "–". */}
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        {t("gradedFootnote", { title: productTitle })}
      </p>
    </section>
  );
}
