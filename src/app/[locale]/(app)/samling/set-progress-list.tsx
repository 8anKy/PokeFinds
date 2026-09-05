"use client";

/**
 * SET-FLIKEN: en rad per set användaren äger något ur.
 *
 * ⛔ EN LISTA, INTE ETT RUTNÄT. Vid 360 px är innerbredden 340 px (skalet äger
 * `px-2.5 sm:px-6`); ett 2-upp-rutnät ger ~165 px per cell, där setnamnet
 * trunkeras till oigenkännlighet och en 70 px stapel läses som dekoration.
 * Samma radmönster som `bevakningar`-vyn och `/sets` redan använder.
 *
 * ⛔ INGEN EGEN VÅGRÄT LUFT och ingen egen bottenpadding: skalet sätter båda,
 * och bottenflikarnas spacer + safe-area räknas redan bort där (ui-shell.md).
 * ⛔ Alla desktopgrenar på `lg:` — en telefon i liggande är ~900×430, så `md:`
 * hade gett den ett skrivbordsläge den inte har plats för.
 * ⛔ Stapelspåret är `surface-overlay`. `surface`/`surface-raised` är BÅDA
 * `#000000` och ett spår målat där är osynligt.
 *
 * ⛔ ALLTID ANTALET BREDVID PROCENTEN, och "–" när vi inte vet. En nolla läses
 * som ett svar; "–" läses som "vi vet inte", vilket är sanningen för de 95
 * japanska seten (noll kort hos oss) och för objekt utan känt marknadsvärde.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { SafeImage } from "@/components/ui/safe-image";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { IconCards, IconChevronDown, IconChevronRight } from "@/components/ui/icons";
import type { SetPortfolioRow } from "@/services/set-portfolio";
import { SET_SORTS, sortSetRows, type SetSort } from "./set-progress-sort";

export function SetProgressList({ rows }: { rows: SetPortfolioRow[] }) {
  const t = useTranslations("SetProgress");
  const [sort, setSort] = useState<SetSort>("closest");
  const sorted = useMemo(() => sortSetRows(rows, sort), [rows, sort]);

  // "Påbörjade" = set där man äger minst ETT kort. Ett set man bara äger sealed ur
  // står kvar i listan (det har ett värde) men är inte påbörjat som samling.
  const started = rows.filter((r) => !r.sealedOnly).length;
  // "Klart" mäts mot den FULLA nämnaren. Ett set utan nämnare kan aldrig räknas
  // som klart — vi vet inte hur stort det är.
  const completed = rows.filter((r) => r.total != null && r.ownedCards >= r.total).length;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconCards size={32} />}
        title={t("emptyTitle")}
        description={t("emptyDesc")}
        action={
          <Link
            href="/sets"
            className="pressable rounded-lg bg-holo-cyan px-4 py-2 text-sm font-semibold text-surface"
          >
            {t("emptyAction")}
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* TVÅ nyckeltal, inte fyra: vid 360 px blir fyra kort fyra höga boxar och
          första setraden hamnar under vecket. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="card-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-ink-faint">{t("statStarted")}</p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">{started}</p>
        </div>
        <div className="card-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-ink-faint">{t("statCompleted")}</p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">{completed}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <div className="relative shrink-0">
          {/* Nativ select — öppnar systemets hjulväljare på telefon. `Select` är
              appearance-none, så chevronen ritas här (samma som toolbaren). */}
          <Select
            id="set-progress-sort"
            value={sort}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const v = e.target.value as SetSort;
              if ((SET_SORTS as readonly string[]).includes(v)) setSort(v);
            }}
            aria-label={t("sortLabel")}
            className="w-auto max-w-[60vw] pr-8 sm:max-w-none"
          >
            {SET_SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`sort_${value}`)}
              </option>
            ))}
          </Select>
          <IconChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        </div>
      </div>

      <ul className="card-surface divide-y divide-surface-border stagger-list">
        {sorted.map((row) => (
          <SetRow key={row.setId} row={row} />
        ))}
      </ul>
    </div>
  );
}

function SetRow({ row }: { row: SetPortfolioRow }) {
  const t = useTranslations("SetProgress");

  const numbers =
    row.total != null
      ? t("progress", { owned: row.ownedCards, total: row.total, percent: row.percent ?? 0 })
      : row.sealedOnly
        ? t("sealedOnly")
        : t("noCardsYet");

  const master =
    row.printings != null && row.masterPercent != null
      ? t("masterProgress", {
          owned: row.ownedPrintings,
          total: row.printings,
          percent: row.masterPercent,
        })
      : null;

  return (
    <li>
      <Link
        href={`/sets/${row.setId}`}
        className="pressable group flex flex-col gap-2 px-3 py-3 transition-colors hover:bg-surface-overlay/60 sm:px-4 lg:px-5"
      >
        <div className="flex items-center gap-3">
          {/* FAST loggruta: set-logotyper har vitt skilda proportioner och texten
              hoppar i sidled utan den. */}
          <span className="grid h-9 w-12 shrink-0 place-items-center">
            <SafeImage
              src={row.logoUrl}
              alt=""
              fallback={<IconCards size={18} className="text-ink-faint" />}
              className="max-h-9 max-w-12 object-contain"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink group-hover:text-holo-cyan">
              {row.setName}
            </span>
            {row.series && (
              <span className="mt-0.5 hidden truncate text-xs text-ink-faint lg:block">
                {row.series}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
            {row.percent != null ? `${row.percent} %` : "–"}
          </span>
          <span className="shrink-0 tabular-nums text-sm text-ink-muted lg:w-28 lg:text-right">
            {row.valueOre != null ? formatPrice(row.valueOre) : "–"}
          </span>
          <IconChevronRight
            size={16}
            aria-hidden="true"
            className="hidden shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 lg:block"
          />
        </div>

        {row.percent != null && (
          <ProgressBar percent={row.percent} label={numbers} />
        )}

        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="truncate">{numbers}</span>
          {master && <span className="truncate tabular-nums">{master}</span>}
        </span>

        {/* ⛔ Lova aldrig "du äger alla kort" när vi VET att setet är större än
            vår lista — då är 100 % ett tak vi själva satt. */}
        {row.catalogShort && (
          <span className="text-xs text-ink-faint">{t("catalogueShortNote")}</span>
        )}
        {row.valueMissingCount > 0 && (
          <span className="text-xs text-ink-faint">
            {t("valueMissing", { count: row.valueMissingCount })}
          </span>
        )}
      </Link>
    </li>
  );
}
