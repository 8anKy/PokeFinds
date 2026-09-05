"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSharedSession } from "@/lib/client-session";
import { useRouter } from "@/i18n/navigation";
import { hasAuthHint } from "@/lib/auth-hint";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconLock } from "@/components/ui/icons";
import { SOURCE_ORDER, sourceGate, type SourceKey } from "@/lib/price-graph-sources";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import type { PriceChartSeries } from "@/components/features/price-chart";
import { openPaywallOrNavigate } from "@/lib/paywall";
import { ProTextLink } from "@/components/features/pro-cta";

export interface PricePoint {
  date: string; // YYYY-MM-DD
  price: number; // öre
}

/**
 * KÄLLFÄRGERNA — validerade, inte valda på känsla.
 *
 * Kört genom dataviz-validatorn mot den svarta ytan: alla par klarar CVD-kravet
 * (värsta paret ΔE 8,4 deutan / 9,8 tritan, mål ≥8) och kontrasten mot bakgrunden
 * är >3:1 för alla fyra. Den enda check som inte går igenom är ljushetsbandet, och
 * det beror på varumärkesfärgen själv (#2dd4bf ligger på L 0,785 mot bandets tak
 * 0,67) — den är appens signatur och byts inte för en graf. Identiteten bärs
 * därför ALDRIG av färg ensam: varje källa har en text-etikett i knappraden som
 * fungerar som diagrammets legend.
 *
 * ⛔ Färgen följer KÄLLAN, aldrig ordningen. Bockar man ur Cardmarket ska Tradera
 * inte plötsligt bli turkos.
 */
export const SOURCE_COLORS: Record<string, string> = {
  cardmarket: "#2dd4bf", // varumärkets turkos
  cardtrader: "#a78bfa",
  tradera: "#f5a524",
  // Rosa var redan med i den validerade fyrfärgspaletten (den satt på "butiker"
  // innan de slutade ritas), så den är mätt mot de tre andra på svart yta och
  // behöver inte valideras om. ⛔ Ge INTE sålt en variant av Traderas gula: två
  // toner av samma färg läser som "samma sak, lite annorlunda", och sålt är en
  // ANNAN storhet än annonspriset — inte en nyans av det.
  traderaSold: "#fb7185",
};

/** Källordning, Pro-grinden och dess dom bor i `@/lib/price-graph-sources`. */
export type { SourceKey };

const PERIODS = [
  { value: "1w", labelKey: "period1w", days: 7 },
  { value: "1m", labelKey: "period1m", days: 30 },
  { value: "3m", labelKey: "period3m", days: 90 },
  { value: "6m", labelKey: "period6m", days: 180 },
  { value: "1y", labelKey: "period1y", days: 365 },
  { value: "max", labelKey: "periodMax", days: Infinity },
] as const;

const DEFAULT = PERIODS.find((p) => p.value === "3m")!;

function withinDays(series: PricePoint[], days: number): PricePoint[] {
  if (!Number.isFinite(days)) return series;
  const cutoff = Date.now() - days * 86_400_000;
  return series.filter((p) => new Date(p.date).getTime() >= cutoff);
}

/**
 * Prishistorik-kortet. Hela serien (alla kända punkter) skickas in EN gång från
 * servern; perioden filtreras i klienten — ingen URL-param (sidan kan därför ISR-
 * cachas) och ingen extra hämtning per periodbyte.
 */
export function ProductPriceCard({
  title,
  subtitle,
  series,
  bySource,
  plain = false,
}: {
  title: string;
  subtitle: string;
  series: PricePoint[];
  /** Alla källors serier. Saknas den beter sig kortet exakt som förut. */
  bySource?: Partial<Record<SourceKey, PricePoint[]>>;
  /**
   * Inne i produktvyns ark (2026-09-05): ingen kortram, kompakt rubrikrad med
   * perioden till höger, och datanoten (subtitle) som fotnot under grafen i
   * stället för under rubriken.
   */
  plain?: boolean;
}) {
  const t = useTranslations("Detail");
  const router = useRouter();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(DEFAULT);
  // Full historik (MAX) är en Pro-förmån. Sidan ISR-cachas → plan läses klient-sida.
  // null/false = ej Pro → MAX låst (klick → prissida). Utloggad räknas som ej Pro.
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (!hasAuthHint()) return;
    void getSharedSession().then((s) => setIsPro(!!s?.user?.isPro));
  }, []);

  // Bara källor som FAKTISKT har punkter får en knapp — en avbockningsbar källa
  // utan data är en död kontroll, och på 5 095 produkter finns bara en källa alls.
  const available = SOURCE_ORDER.filter((k) => (bySource?.[k]?.length ?? 0) > 0);
  /**
   * START: EN källa, inte alla.
   *
   * Cardmarket är förvalet — det är den källa rubriken och det publicerade priset
   * bygger på ("golvet rakt av"), så grafen öppnar på samma tal som står ovanför
   * den. Alla serier påslagna från början gav dessutom ett överlagrat diagram
   * innan besökaren bett om en jämförelse; att lägga TILL en kurva är ett aktivt
   * val, att behöva plocka BORT tre är städning.
   *
   * ⛔ FALLER TILLBAKA PÅ FÖRSTA TILLGÄNGLIGA. Tryckningsvarianterna (reverse
   * holo, boll, 1st Edition) har INGEN Cardmarket-serie alls — CardTrader är hela
   * deras historik. Ett hårdkodat "cardmarket" hade öppnat dem på en tom ruta.
   */
  const [off, setOff] = useState<Set<string>>(() => {
    const primary = available.includes("cardmarket") ? "cardmarket" : available[0];
    return new Set(available.filter((k) => k !== primary));
  });
  // Pro-grinden: Tradera-serierna är låsta för gratisanvändare. Domen är ren och
  // testad — se @/lib/price-graph-sources.
  const { selected, isLocked, proGated } = sourceGate(available, off, isPro);

  const filtered = withinDays(series, period.days);
  // Gles historik (t.ex. äldre sealed med en ensam arkivpunkt): har vald period
  // < 2 punkter men hela serien fler → visa hela istället för ett ensamt nuläge.
  const data = filtered.length < 2 && series.length >= 2 ? series : filtered;

  // Valda källor → serier för grafen. Perioden filtreras med samma regel som den
  // enkla serien: hellre hela historiken än en ensam punkt.
  const chartSeries: PriceChartSeries[] | undefined = available.length
    ? selected.map((key) => {
        const points = bySource?.[key] ?? [];
        const win = withinDays(points, period.days);
        return {
          key,
          label: t(`source_${key}` as never),
          color: SOURCE_COLORS[key],
          points: win.length < 2 && points.length >= 2 ? points : win,
        };
      })
    : undefined;
  // Enkelserie-vägen (yta, uttoning, endpoint-prick) behålls när exakt en källa
  // har punkter i fönstret — den är mer läsbar än en naken linje.
  //
  // ⛔ `series`-PROPEN FÅR INTE VARA RESERVEN NÄR VI HAR KÄLLOR. Den är
  // trendserien (`trendSource` i services/products), och den PEKAR PÅ TRADERA när
  // Cardmarket saknas — dvs precis den kurva som är Pro-låst. Den gamla raden lät
  // dessutom `data` vinna så fort två källor var valda men bara en hade punkter i
  // perioden, och ritade då en serie ingen bockat i. Nu ritas den valda källan;
  // trendserien används bara i legacy-läget helt utan `bySource`.
  const withPoints = chartSeries?.filter((s) => s.points.length > 0) ?? [];
  const chartSingle = available.length
    ? withPoints.length === 1
      ? withPoints[0].points
      : []
    : data;

  const periodControl = (
    <div
      className={cn(
        "flex shrink-0 gap-0.5 self-start rounded-lg border border-surface-border bg-surface p-1",
        plain && "p-[3px]"
      )}
      role="group"
      aria-label="Period"
    >
      {PERIODS.map((p) => {
        const locked = p.value === "max" && !isPro;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => (locked ? openPaywallOrNavigate(router, { source: "chart-max" }) : setPeriod(p))}
            aria-current={p.value === period.value ? "true" : undefined}
            title={locked ? t("maxProOnly") : undefined}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
              plain && "px-2",
              p.value === period.value
                ? "bg-holo-cyan/15 text-holo-cyan"
                : locked
                  ? "text-ink-faint hover:text-holo-cyan"
                  : "text-ink-muted hover:text-ink"
            )}
          >
            {locked && <IconLock size={11} />}
            {t(p.labelKey)}
          </button>
        );
      })}
    </div>
  );

  // I arket (plain) visas chipsraden bara när det finns ett VAL att göra — minst
  // två upplåsta källor. Ett ensamt Cardmarket-chip plus ett låst Tradera-chip var
  // två rader text för noll valmöjligheter; Tradera-upsellen finns kvar i kortet
  // på desktop och via MAX-perioden.
  const unlockedCount = available.filter((k) => !isLocked(k)).length;
  const showChips = !proGated && available.length > 1 && (!plain || unlockedCount > 1);
  const chips = showChips && (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("sourceFilter")}>
      {available.map((key) => {
        const chipLocked = isLocked(key);
        if (plain && chipLocked) return null;
        const on = !chipLocked && !off.has(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            title={chipLocked ? t("traderaProOnly") : undefined}
            onClick={() => {
              // Låst chip väljer INGENTING — den säljer. Samma gest som
              // MAX-perioden: ett tryck tar dig till prissidan.
              if (chipLocked) {
                openPaywallOrNavigate(router, { source: "chart-tradera" });
                return;
              }
              setOff((prev) => {
                const next = new Set(prev);
                // Minst en källa måste vara vald — annars står man inför en
                // tom ruta utan att förstå varför.
                if (!next.has(key) && selected.length === 1) return prev;
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
              on
                ? "border-surface-border bg-surface-overlay text-ink"
                : chipLocked
                  ? "border-surface-border/60 text-ink-faint hover:text-holo-cyan"
                  : "border-surface-border/60 text-ink-faint hover:text-ink-muted"
            )}
          >
            {chipLocked ? (
              <IconLock size={11} />
            ) : (
              <span
                className="inline-block h-2 w-2 rounded-full transition-opacity"
                style={{ backgroundColor: SOURCE_COLORS[key], opacity: on ? 1 : 0.3 }}
              />
            )}
            {t(`source_${key}` as never)}
          </button>
        );
      })}
    </div>
  );

  // data-swipe-ignore: horisontellt drag på grafen = tooltip-scrubbing,
  // inte svep-tillbaka (overlayns gest hoppar över den här ytan).
  const chart = proGated ? (
    <EmptyState
      icon={<IconLock size={28} />}
      title={t("traderaProTitle")}
      description={t("traderaProDesc")}
      action={
        <ProTextLink
          source="chart-tradera"
          className="rounded-full bg-holo-cyan/15 px-4 py-1.5 text-xs font-semibold text-holo-cyan transition-colors hover:bg-holo-cyan/25"
        >
          {t("traderaProCta")}
        </ProTextLink>
      }
    />
  ) : (
    <div data-swipe-ignore>
      <PriceChartLazy data={chartSingle} series={chartSeries} quiet={plain} />
    </div>
  );

  if (plain) {
    // ARKET: rubrik + period på EN rad ovanför kurvan (som i design-canvasen —
    // utan rubriken kändes ytan tom, ägaren 2026-09-05), källchips under kurvan
    // bara när det finns flera källor att välja på. Ingen datanot.
    return (
      <section aria-label={title}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {periodControl}
        </div>
        {chart}
        {/* Datanoten ("Raw, ej graderad · annonser = …") visas INTE i arket — den
            är en förklaring till desktopkortets rubrik, i telefonen läste den som
            brus (ägaren 2026-09-05). Chipsen är själva legenden. */}
        {showChips && <div className="mt-3">{chips}</div>}
      </section>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>
        </div>
        {periodControl}
      </CardHeader>
      <CardContent>
        {showChips && <div className="mb-3">{chips}</div>}
        {chart}
      </CardContent>
    </Card>
  );
}
