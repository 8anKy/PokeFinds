"use client";

/**
 * "13 / 120" med en tunn stapel — hur långt användaren kommit i setet, plus en
 * andra rad för MASTER SET (varje tryckning, inte bara varje kort).
 *
 * SAMMA RADFORM SOM SET-FLIKEN I SAMLINGEN (2026-09-06): etikett till vänster,
 * antalet till höger, stapeln under med procenten i högerkanten. Tidigare stod
 * "13 av 120 · 11 %" + "13 av 187 tryckningar · 7 %" + en hel mening om
 * tryckningarna — ägaren: "för mycket text". Noten om att setet har fler
 * tryckningar än vi listar är kvar, men som fyra ord under master-raden.
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

function Row({
  label,
  owned,
  total,
  percent,
  ariaLabel,
  tone,
  note,
}: {
  label: string;
  owned: number;
  total: number;
  percent: number;
  ariaLabel: string;
  tone: "cyan" | "muted";
  note?: string | null;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-ink">
          {owned} / {total}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <ProgressBar percent={percent} label={ariaLabel} tone={tone} className="flex-1" />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{percent} %</span>
      </div>
      {note && <p className="mt-1 text-[11px] text-ink-faint">{note}</p>}
    </div>
  );
}

export function SetCompletionBar({ setId }: { setId: string }) {
  const t = useTranslations("SetCompletion");
  const c = useSetCompletion(setId);

  if (!c || c.total <= 0 || c.ownedCount === 0) return null;

  const cardPercent = completionPercent(c.ownedCount, c.total) ?? 0;
  // Master set-raden visas bara när den TILLFÖR något: listar vi inga varianter
  // alls är nämnaren identisk med kortnämnaren, och två likadana rader är brus.
  const showMaster = c.printingsTotal > c.total;
  const masterPercent = completionPercent(c.ownedPrintings, c.printingsTotal);

  return (
    <div className="mt-6 space-y-4">
      <Row
        label={t("title")}
        owned={c.ownedCount}
        total={c.total}
        percent={cardPercent}
        ariaLabel={t("progress", { owned: c.ownedCount, total: c.total, percent: cardPercent })}
        tone="cyan"
        /* ⛔ "Du äger alla kort" får aldrig sägas när vi VET att setet är större
           än vår lista. Då är 100 % ett tak vi själva satt, inte en bedrift. */
        note={c.catalogShort ? t("catalogueShortNote") : null}
      />
      {showMaster && masterPercent != null && (
        <Row
          label={t("masterTitle")}
          owned={c.ownedPrintings}
          total={c.printingsTotal}
          percent={masterPercent}
          ariaLabel={t("printingsProgress", {
            owned: c.ownedPrintings,
            total: c.printingsTotal,
            percent: masterPercent,
          })}
          tone="muted"
          /* Nämnaren ovan är vad VI listar — nåbart. Att setet har fler
             tryckningar är en ärlig not, aldrig ett tal vi mäter någon mot. */
          note={
            c.printingsElsewhere > 0
              ? t("printingsElsewhereNote", { total: c.printingsElsewhere, listed: c.printingsTotal })
              : null
          }
        />
      )}
    </div>
  );
}
