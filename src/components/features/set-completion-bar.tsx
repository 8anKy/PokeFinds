"use client";

/**
 * "64 av 120 · 53 %" med en tunn stapel — hur långt användaren kommit i setet,
 * plus en andra rad för MASTER SET (varje tryckning, inte bara varje kort).
 *
 * KLIENT-SIDA MED FLIT: setsidan är ISR-cachad (`revalidate = 3600`) och får
 * varken bli `force-dynamic` eller kalla `auth()`. Siffran hämtas därför via
 * `lib/set-completion.ts`, som delar ETT anrop med rutnätets filter.
 *
 * ⛔ VISAS BARA FÖR DEN SOM ÄGER MINST ETT KORT I SETET. En utloggad besökare —
 * eller en inloggad som aldrig rört setet — ska inte mötas av en tom nolla; det
 * är en tom lovord om en funktion, inte information.
 *
 * ⛔ ALLTID ANTALET BREDVID PROCENTEN. Procenten ensam går inte att kontrollera,
 * och nämnaren har historiskt varit fel sorts tal (`printedTotal` gav "120 av
 * 84"). Antalet gör felet synligt i stället för trovärdigt.
 */

import { useTranslations } from "next-intl";
import { useSetCompletion } from "@/lib/set-completion";
import { completionPercent } from "@/lib/set-denominator";
import { ProgressBar } from "@/components/ui/progress-bar";

export function SetCompletionBar({ setId }: { setId: string }) {
  const t = useTranslations("SetCompletion");
  const c = useSetCompletion(setId);

  if (!c || c.total <= 0 || c.ownedCount === 0) return null;

  const cardPercent = completionPercent(c.ownedCount, c.total) ?? 0;
  const cardNumbers = t("progress", {
    owned: c.ownedCount,
    total: c.total,
    percent: cardPercent,
  });

  // Master set-raden visas bara när den TILLFÖR något: listar vi inga varianter
  // alls är nämnaren identisk med kortnämnaren, och två likadana rader är brus.
  const showMaster = c.printingsTotal > c.total;
  const masterPercent = completionPercent(c.ownedPrintings, c.printingsTotal);
  const masterNumbers =
    masterPercent != null
      ? t("printingsProgress", {
          owned: c.ownedPrintings,
          total: c.printingsTotal,
          percent: masterPercent,
        })
      : null;

  return (
    <div className="mt-6 space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("title")}
          </span>
          <span className="text-sm font-medium text-ink">{cardNumbers}</span>
        </div>
        <ProgressBar percent={cardPercent} label={cardNumbers} className="mt-2" />
        {/* ⛔ "Du äger alla kort" får aldrig sägas när vi VET att setet är större
            än vår lista. Då är 100 % ett tak vi själva satt, inte en bedrift. */}
        {c.catalogShort && (
          <p className="mt-1.5 text-xs text-ink-faint">{t("catalogueShortNote")}</p>
        )}
      </div>

      {showMaster && masterNumbers && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("masterTitle")}
            </span>
            <span className="text-sm font-medium text-ink">{masterNumbers}</span>
          </div>
          <ProgressBar
            percent={masterPercent ?? 0}
            label={masterNumbers}
            tone="muted"
            className="mt-2"
          />
          {/* Nämnaren ovan är vad VI listar — nåbart. Att setet har fler
              tryckningar är en ärlig not, aldrig ett tal vi mäter någon mot. */}
          {c.printingsElsewhere > 0 && (
            <p className="mt-1.5 text-xs text-ink-faint">
              {t("printingsElsewhereNote", {
                total: c.printingsElsewhere,
                listed: c.printingsTotal,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
