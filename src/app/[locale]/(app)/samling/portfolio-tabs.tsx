"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Flikväxlare i portföljen: aktiv samling vs sålda objekt. Båda hålls monterade
 *  (döljs med CSS) så samlingens klient-state inte tappas vid flikbyte. */
export function PortfolioTabs({
  collection,
  sold,
  soldCount,
}: {
  collection: ReactNode;
  sold: ReactNode;
  soldCount: number;
}) {
  const t = useTranslations("Collection");
  const [tab, setTab] = useState<"collection" | "sold">("collection");

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
      active
        ? "border-holo-cyan text-ink"
        : "border-transparent text-ink-muted hover:text-ink"
    }`;

  return (
    <div>
      <div role="tablist" className="mb-6 flex gap-2 border-b border-surface-border">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "collection"}
          className={tabClass(tab === "collection")}
          onClick={() => setTab("collection")}
        >
          {t("tabCollection")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sold"}
          className={tabClass(tab === "sold")}
          onClick={() => setTab("sold")}
        >
          {t("tabSold")}{soldCount > 0 ? ` (${soldCount})` : ""}
        </button>
      </div>

      <div className={tab === "collection" ? "" : "hidden"}>{collection}</div>
      <div className={tab === "sold" ? "" : "hidden"}>{sold}</div>
    </div>
  );
}
