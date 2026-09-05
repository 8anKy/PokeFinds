"use client";

/**
 * SET-FLIKEN: en rad per set användaren äger något ur.
 *
 * ETT MÅTT PER RAD (ägarbeslut 2026-09-06 — "svårt att förstå, för mycket text"):
 * raden visar logga, namn, "13 / 120" och EN stapel med procenten i högerkanten.
 * Vad som mäts väljs EN gång ovanför listan: **Kort** (varje kort i setet) eller
 * **Master set** (varje tryckning). Tidigare bar varje rad båda måtten, ett
 * värde i kronor och två fotnoter — fem tal och fyra rader per set.
 * ⛔ Inget kronvärde på raden: "8,69 kr" bredvid en procent läste som ett pris.
 * Värdet finns kvar som sortering ("Högst värde"); summan bor på Samling-fliken.
 * ⛔ Fotnoterna ("vi listar 187 av 200", "N poster saknar värde") bor på setsidan.
 *
 * ⛔ EN LISTA, INTE ETT RUTNÄT. Vid 360 px är innerbredden 340 px (skalet äger
 * `px-2.5 sm:px-6`); ett 2-upp-rutnät ger ~165 px per cell, där setnamnet
 * trunkeras till oigenkännlighet och en 70 px stapel läses som dekoration.
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
import { cn } from "@/lib/utils";
import { SafeImage } from "@/components/ui/safe-image";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { IconCards, IconChevronDown, IconChevronRight } from "@/components/ui/icons";
import type { SetPortfolioRow } from "@/services/set-portfolio";
import { SET_SORTS, sortSetRows, type SetMeasure, type SetSort } from "./set-progress-sort";

export function SetProgressList({ rows }: { rows: SetPortfolioRow[] }) {
  const t = useTranslations("SetProgress");
  const [sort, setSort] = useState<SetSort>("closest");
  const [measure, setMeasure] = useState<SetMeasure>("cards");
  const sorted = useMemo(() => sortSetRows(rows, sort, measure), [rows, sort, measure]);

  // "Påbörjade" = set där man äger minst ETT kort. Ett set man bara äger sealed ur
  // står kvar i listan (det har ett värde) men är inte påbörjat som samling.
  const started = rows.filter((r) => !r.sealedOnly).length;
  // "Klart" mäts mot den FULLA nämnaren. Ett set utan nämnare kan aldrig räknas
  // som klart — vi vet inte hur stort det är.
  const completed = rows.filter((r) => r.total != null && r.ownedCards >= r.total).length;
  // Master set-växeln visas bara när något set faktiskt HAR tryckningar utöver
  // korten — annars är den ett val mellan två likadana listor.
  const hasMaster = rows.some((r) => r.printings != null && r.total != null && r.printings > r.total);

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

      <div className="flex items-center justify-between gap-3">
        {/* Måttet: Kort | Master set. Samma segmentform som prishistorikens
            periodväljare, så den läses som ett läge och inte som en filterrad. */}
        {hasMaster ? (
          <div
            role="group"
            aria-label={t("measureLabel")}
            className="flex gap-0.5 rounded-lg border border-surface-border bg-surface p-[3px]"
          >
            {(["cards", "master"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMeasure(m)}
                aria-pressed={measure === m}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                  measure === m ? "bg-holo-cyan/15 text-holo-cyan" : "text-ink-muted hover:text-ink"
                )}
              >
                {m === "cards" ? t("measureCards") : t("measureMaster")}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
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
            className="w-auto max-w-[50vw] pr-8 sm:max-w-none"
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
          <SetRow key={row.setId} row={row} measure={measure} />
        ))}
      </ul>
    </div>
  );
}

function SetRow({ row, measure }: { row: SetPortfolioRow; measure: SetMeasure }) {
  const t = useTranslations("SetProgress");

  // Radens ENDA tal: ägda / nämnare i valt mått. Saknas nämnaren → "–" (aldrig 0).
  const owned = measure === "master" ? row.ownedPrintings : row.ownedCards;
  const total = measure === "master" ? row.printings : row.total;
  const percent = measure === "master" ? row.masterPercent : row.percent;
  const count = total != null ? t("countOf", { owned, total }) : "–";
  const ariaLabel =
    total != null
      ? measure === "master"
        ? t("masterProgress", { owned, total })
        : t("progress", { owned, total, percent: percent ?? 0 })
      : row.sealedOnly
        ? t("sealedOnly")
        : t("noCardsYet");

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
            <span className="block truncate text-[15px] font-medium text-ink group-hover:text-holo-cyan">
              {row.setName}
            </span>
            {row.series && (
              <span className="mt-0.5 hidden truncate text-xs text-ink-faint lg:block">
                {row.series}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{count}</span>
          <IconChevronRight
            size={16}
            aria-hidden="true"
            className="hidden shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 lg:block"
          />
        </div>

        {percent != null && (
          <div className="flex items-center gap-3">
            <ProgressBar
              percent={percent}
              label={ariaLabel}
              tone={measure === "master" ? "muted" : "cyan"}
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">
              {percent} %
            </span>
          </div>
        )}
      </Link>
    </li>
  );
}
