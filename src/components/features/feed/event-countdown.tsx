/**
 * "Om 24 dagar"-pillret på ett evenemang.
 *
 * ⛔ KLIENTSIDIGT MED FLIT. Sidan är ISR-cachad i en timme, så ett serverrenderat
 *    tal hade kunnat vara ett dygn fel för den som öppnar sidan strax efter
 *    midnatt. Komponenten renderar därför INGENTING på servern och räknar först
 *    efter montering — då stämmer talet alltid, och det blir ingen
 *    hydreringsskillnad att tysta med flaggor.
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { countdownFor } from "@/lib/event-format";

export function EventCountdown({ startsAt }: { startsAt: string }) {
  const t = useTranslations("News");
  const [state, setState] = useState<ReturnType<typeof countdownFor>>(null);

  useEffect(() => {
    setState(countdownFor(startsAt));
  }, [startsAt]);

  if (!state) return null;
  const label =
    state.key === "today" ? t("startsToday") : state.key === "tomorrow" ? t("startsTomorrow") : t("startsInDays", { days: state.days });

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-holo-cyan/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-holo-cyan ring-1 ring-inset ring-holo-cyan/30">
      <span className="h-1.5 w-1.5 rounded-full bg-holo-cyan" aria-hidden="true" />
      {label}
    </span>
  );
}
