"use client";

/**
 * Tunn förloppsstapel med inanimerad start → animerad fyllning.
 *
 * ⛔ SPÅRET ÄR `surface-overlay`, INTE `surface`/`surface-raised`. De två senare
 * är BÅDA `#000000` (ui-shell.md) — ett spår målat där är osynligt på svart yta,
 * och stapeln ser då ut att sakna sin nedre halva. `surface-overlay` är en
 * interaktiv FYLLNING och är det enda som syns här.
 *
 * Fyllningen sätts först i bildrutan EFTER monteringen, så rörelsen syns i
 * stället för att stapeln poppar in färdig.
 */
import { useEffect, useState } from "react";

export function ProgressBar({
  percent,
  label,
  tone = "cyan",
  className = "",
}: {
  percent: number;
  /** Läses av skärmläsare — ge den siffrorna, inte bara procenten. */
  label: string;
  tone?: "cyan" | "muted";
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped]);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className={`h-1.5 overflow-hidden rounded-full bg-surface-overlay ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out-soft ${
          tone === "cyan" ? "bg-holo-cyan" : "bg-ink-faint"
        }`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
