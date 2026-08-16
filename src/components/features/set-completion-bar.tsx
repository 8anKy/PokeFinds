"use client";

/**
 * "64 av 165 · 39 %" med en tunn stapel — hur långt användaren kommit i setet.
 *
 * KLIENT-SIDA MED FLIT: setsidan är ISR-cachad (`revalidate = 3600`) och får
 * varken bli `force-dynamic` eller kalla `auth()`. Siffran hämtas därför via
 * `lib/set-completion.ts`, som delar ETT anrop med rutnätets filter.
 *
 * ⛔ VISAS BARA FÖR DEN SOM ÄGER MINST ETT KORT I SETET. En utloggad besökare —
 * eller en inloggad som aldrig rört setet — ska inte mötas av en tom nolla; det
 * är en tom lovord om en funktion, inte information.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSetCompletion } from "@/lib/set-completion";

export function SetCompletionBar({ setId }: { setId: string }) {
  const t = useTranslations("SetCompletion");
  const completion = useSetCompletion(setId);

  // ⛔ Klampad till 100: nämnaren (`totalCards` från pokemontcg.io) räknar inte
  // alltid secret rares, så en samlare kan äga FLER kort än setet påstår ha.
  // Antalet visas därför alltid bredvid procenten — "172 av 165" är ärligt,
  // "104 %" hade bara sett trasigt ut.
  const percent =
    completion && completion.total > 0
      ? Math.min(100, Math.round((completion.ownedCount / completion.total) * 100))
      : 0;

  // Stapeln fylls på i första bildrutan efter att siffran landat, så rörelsen
  // syns i stället för att stapeln bara poppar in färdig.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(percent));
    return () => cancelAnimationFrame(id);
  }, [percent]);

  if (!completion || completion.total <= 0 || completion.ownedCount === 0) return null;

  const numbers = t("progress", {
    owned: completion.ownedCount,
    total: completion.total,
    percent,
  });

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {t("title")}
        </span>
        <span className="text-sm font-medium text-ink">{numbers}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={numbers}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-overlay"
      >
        <div
          className="h-full rounded-full bg-holo-cyan transition-[width] duration-700 ease-out-soft"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
