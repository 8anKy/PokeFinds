import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";
import { formatPercent, formatPrice } from "@/lib/format";
import type { DailyChange } from "@/lib/collection-daily";

/**
 * "Idag"-kortet överst i samlingen — se `lib/collection-daily.ts` för metoden.
 *
 * ⛔ Serverkomponent utan egen fråga: talen räknas i `computeCollectionValue` ur de
 *    snapshots sidan redan hämtar för grafen. Kortet kostar alltså ingen extra
 *    databasläsning (skälet till att det bor här och inte på Utforska).
 * ⛔ Förhandsvisning: sidan renderar det bara när `previewAllowedFor("DAILY_CARD")`.
 */
function signedPrice(ore: number): string {
  if (ore === 0) return formatPrice(0);
  return `${ore > 0 ? "+" : "−"}${formatPrice(Math.abs(ore))}`;
}

export async function DailyChangeCard({
  daily,
  empty,
  slugByItem,
}: {
  daily: DailyChange | null;
  /** Samlingen (den valda pärmen) har inga poster alls. */
  empty: boolean;
  slugByItem: Map<string, string | null | undefined>;
}) {
  const t = await getTranslations("Collection");

  if (empty) {
    return (
      <section className="card-surface flex flex-col items-start gap-3 p-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-holo-cyan">{t("dailyTitle")}</div>
        <p className="text-pretty text-sm leading-relaxed text-ink-muted">{t("dailyEmpty")}</p>
        <LinkButton href="/skanna" size="sm">
          {t("dailyEmptyCta")}
        </LinkButton>
      </section>
    );
  }
  // Ingen post går att mäta än (nyligen tillagt, inga två prisdagar) — hellre inget
  // kort än ett gissat tal.
  if (!daily) return null;

  const up = daily.deltaOre > 0;
  const down = daily.deltaOre < 0;
  const tone = up ? "text-rise" : down ? "text-fall" : "text-ink-muted";

  return (
    <section className="card-surface p-4" aria-label={t("dailyTitle")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-holo-cyan">{t("dailyTitle")}</span>
        <span className="text-[11px] text-ink-faint">{t("dailySubtitle")}</span>
      </div>

      {up || down ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={`font-display text-[28px] font-bold leading-none tabular-nums ${tone}`}>
            {signedPrice(daily.deltaOre)}
          </span>
          {daily.percent != null && (
            <span className={`text-sm font-semibold tabular-nums ${tone}`}>
              {up ? "▲" : "▼"} {formatPercent(Math.abs(daily.percent), false)}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-ink-muted">{t("dailyUnchanged")}</p>
      )}

      {daily.movers.length > 0 && (
        <ul className="mt-3 divide-y divide-surface-border border-t border-surface-border">
          {daily.movers.map((m) => {
            const rise = m.deltaOre > 0;
            const slug = slugByItem.get(m.id);
            const row = (
              <>
                <span className={`w-3 shrink-0 text-xs ${rise ? "text-rise" : "text-fall"}`} aria-hidden>
                  {rise ? "▲" : "▼"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.name}</span>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${rise ? "text-rise" : "text-fall"}`}>
                  {signedPrice(m.deltaOre)}
                </span>
              </>
            );
            return (
              <li key={m.id}>
                {slug ? (
                  <Link
                    href={`/produkter/${slug}`}
                    className="flex min-h-[44px] items-center gap-2.5 py-2 transition-colors hover:text-holo-cyan"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex min-h-[44px] items-center gap-2.5 py-2">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
