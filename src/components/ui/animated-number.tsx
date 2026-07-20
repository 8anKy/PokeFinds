"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";

export interface AnimatedNumberProps {
  /** Öre för kind="price", heltal för kind="int", decimaltal för kind="decimal" (1 decimal, punkt). */
  value: number;
  kind?: "price" | "int" | "decimal";
  /** Animationslängd i ms. */
  duration?: number;
  className?: string;
}

/**
 * Räknar mjukt upp till värdet vid mount (från 0) och vid värdeändring (från
 * föregående). Server-HTML:en visar slutvärdet direkt (ingen hydration-mismatch,
 * funkar utan JS). Reduced motion → hoppar direkt till slutvärdet.
 * Under animationen avrundas priser till hela kronor (öre-jitter ser oroligt ut);
 * slutvärdet visas exakt.
 */
export function AnimatedNumber({
  value,
  kind = "price",
  duration = 800,
  className,
}: AnimatedNumberProps) {
  const locale = useLocale();
  const [display, setDisplay] = useState(value);
  const [settled, setSettled] = useState(true);
  const fromRef = useRef(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = value;
      setDisplay(value);
      setSettled(true);
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    setSettled(false);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (value - from) * eased;
      if (t < 1) {
        setDisplay(
          kind === "price" ? Math.round(v / 100) * 100 : kind === "decimal" ? v : Math.round(v)
        );
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
        setDisplay(value);
        setSettled(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, kind]);

  const shown = settled ? value : display;
  const text =
    kind === "price"
      ? formatPrice(shown)
      : kind === "decimal"
        ? shown.toFixed(1)
        : new Intl.NumberFormat(locale).format(shown);
  return <span className={cn("tabular-nums", className)}>{text}</span>;
}
