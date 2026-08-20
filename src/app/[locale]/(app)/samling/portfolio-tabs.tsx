"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { hapticTick } from "@/lib/haptics";

type Tab = "collection" | "sets" | "sold";
const TABS: Tab[] = ["collection", "sets", "sold"];

/** Flikväxlare i portföljen: aktiv samling, set-komplettering och sålda objekt.
 *  Alla hålls monterade (döljs med CSS) så samlingens klient-state inte tappas
 *  vid flikbyte — därför måste set-datan komma som server-props, inte hämtas
 *  när fliken öppnas.
 *
 *  ⛔ TRE FLIKAR RYMS PÅ 360 px, men inte fyra. Räknat: innerbredden är 340 px
 *  (skalet äger `px-2.5`), och `px-4 py-2.5 text-sm font-semibold` ger ~94 px
 *  för "Samling", ~94 för "Sålt (12)" och ~58 för "Set" — 262 px av 340 med
 *  `gap-2`. Växer antalssuffixet döljs det under `sm:` snarare än att en
 *  overflow-scroller införs; flikraden har ingen idag och ska inte få en. */
export function PortfolioTabs({
  collection,
  sets,
  sold,
  soldCount,
}: {
  collection: ReactNode;
  sets: ReactNode;
  sold: ReactNode;
  soldCount: number;
}) {
  const t = useTranslations("Collection");
  const [tab, setTab] = useState<Tab>("collection");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    collection: null,
    sets: null,
    sold: null,
  });

  // Samma taktila kvittens som bottenflikarna — ett flikbyte ska kännas likadant
  // var i appen det än sker. ⛔ Bara vid ett FAKTISKT byte: att trycka på fliken
  // man redan står på ändrar ingenting, och en vibration då ljuger.
  const pick = (next: Tab) => {
    if (next !== tab) hapticTick();
    setTab(next);
  };

  // Piltangenter i en tablist är förväntat beteende (WAI-ARIA) och saknades helt.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
    pick(next);
    tabRefs.current[next]?.focus();
  };

  const label = (v: Tab) =>
    v === "collection"
      ? t("tabCollection")
      : v === "sets"
        ? t("tabSets")
        : `${t("tabSold")}${soldCount > 0 ? ` (${soldCount})` : ""}`;

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
      active
        ? "border-holo-cyan text-ink"
        : "border-transparent text-ink-muted hover:text-ink"
    }`;

  const panel = (v: Tab, content: ReactNode) => (
    <div
      id={`portfolio-panel-${v}`}
      role="tabpanel"
      aria-labelledby={`portfolio-tab-${v}`}
      tabIndex={0}
      className={tab === v ? "" : "hidden"}
    >
      {content}
    </div>
  );

  return (
    <div>
      <div role="tablist" className="mb-6 flex gap-2 border-b border-surface-border">
        {TABS.map((v) => (
          <button
            key={v}
            ref={(el) => {
              tabRefs.current[v] = el;
            }}
            type="button"
            role="tab"
            id={`portfolio-tab-${v}`}
            aria-selected={tab === v}
            aria-controls={`portfolio-panel-${v}`}
            tabIndex={tab === v ? 0 : -1}
            className={tabClass(tab === v)}
            onClick={() => pick(v)}
            onKeyDown={onKeyDown}
          >
            {label(v)}
          </button>
        ))}
      </div>

      {panel("collection", collection)}
      {panel("sets", sets)}
      {panel("sold", sold)}
    </div>
  );
}
