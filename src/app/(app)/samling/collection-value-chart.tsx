"use client";

import { useState } from "react";
import Link from "next/link";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { cn } from "@/lib/utils";

type Point = { date: string; price: number };

const RANGES = [
  { key: "1v", label: "1v", days: 7 },
  { key: "1m", label: "1m", days: 30 },
  { key: "3m", label: "3m", days: 90 },
  { key: "6m", label: "6m", days: 183 },
  { key: "max", label: "Max", days: null },
] as const;

/** Beräknar datumsträng (YYYY-MM-DD) N dagar före `lastDate`. */
function cutoff(lastDate: string, days: number): string {
  const d = new Date(`${lastDate}T00:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function CollectionValueChart({ data, isPremium }: { data: Point[]; isPremium: boolean }) {
  const [range, setRange] = useState<string>("max");

  const r = RANGES.find((x) => x.key === range) ?? RANGES[RANGES.length - 1];
  const filtered =
    r.days == null || data.length === 0
      ? data
      : data.filter((p) => p.date >= cutoff(data[data.length - 1].date, r.days));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {RANGES.map((opt) => {
          // Max är en premium-funktion: gratis-användare ser bara upp till 6 mån.
          if (opt.key === "max" && !isPremium) {
            return (
              <Link
                key={opt.key}
                href="/priser"
                className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-faint hover:text-holo-cyan"
                title="Lås upp full historik med Premium"
              >
                🔒 Max
              </Link>
            );
          }
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRange(opt.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                range === opt.key
                  ? "bg-holo-cyan/15 text-holo-cyan"
                  : "text-ink-muted hover:bg-surface-overlay"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <PriceChartLazy data={filtered} minimal />
    </div>
  );
}
