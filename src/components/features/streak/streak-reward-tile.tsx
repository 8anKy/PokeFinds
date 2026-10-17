"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Skannerns sökare runt ett kort. */
function ScanGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="10" y="7" width="12" height="18" rx="2.2" fill="#fff" opacity="0.95" />
      <rect x="12.4" y="9.4" width="7.2" height="6.6" rx="1.2" fill="#2dd4bf" />
      <path d="M4 10V7a3 3 0 0 1 3-3h3M22 4h3a3 3 0 0 1 3 3v3M28 22v3a3 3 0 0 1-3 3h-3M10 28H7a3 3 0 0 1-3-3v-3" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** En graderad slab med stjärna. */
function GradeGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="7" y="3" width="18" height="26" rx="3" fill="#fff" opacity="0.95" />
      <rect x="9.5" y="5.5" width="13" height="4.5" rx="1" fill="#a78bfa" />
      <path d="M16 13.2l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#f59e0b" />
    </svg>
  );
}

const KINDS = {
  scan: { glyph: <ScanGlyph />, from: "#2dd4bf", to: "#0f9488", lip: "#0b6b62" },
  grade: { glyph: <GradeGlyph />, from: "#b69cff", to: "#7c5cf0", lip: "#5b3fc4" },
} as const;

/** En påfyllningsbricka: ikon i färgad platta, siffran räknar upp från 0. */
export function StreakRewardTile({
  kind,
  amount,
  label,
  delayMs = 0,
  className,
}: {
  kind: keyof typeof KINDS;
  amount: number;
  label: string;
  delayMs?: number;
  className?: string;
}) {
  const k = KINDS[kind];
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(amount);
      return;
    }
    let raf = 0;
    const start = window.setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 650);
        setShown(Math.round(amount * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs + 250);
    return () => {
      window.clearTimeout(start);
      cancelAnimationFrame(raf);
    };
  }, [amount, delayMs]);

  return (
    <div className={cn("streak-pop", className)} style={{ animationDelay: `${delayMs}ms` }}>
      <div
        className="relative overflow-hidden rounded-2xl p-3 text-left"
        style={{
          background: `linear-gradient(180deg, ${k.from} 0%, ${k.to} 100%)`,
          boxShadow: `0 4px 0 0 ${k.lip}`,
        }}
      >
        <span className="streak-shine pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/15">{k.glyph}</span>
          <div className="min-w-0">
            <div className="font-display text-2xl font-black leading-none text-white tabular-nums">+{shown}</div>
            <div className="mt-1 truncate text-xs font-bold text-white/85">{label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
