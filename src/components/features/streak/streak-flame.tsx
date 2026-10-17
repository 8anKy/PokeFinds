"use client";

import { cn } from "@/lib/utils";

/**
 * Veckoseriens låga — illustrationen i public/streak/flame.webp (320 px, 13 kB).
 * `active` = dagen är gjord (orange); annars grå, samma signal som appar med
 * dagsserier använder: grått = rädda dagen. `animated` låter den fladdra och
 * `glow` lägger en varm ljuskägla bakom. Animationerna ligger på EGNA omslag:
 * en fylld animation skriver annars över transform på elementet (globals.css).
 */
export function StreakFlame({
  size = 28,
  active = true,
  animated = false,
  glow = false,
  className,
}: {
  size?: number;
  active?: boolean;
  animated?: boolean;
  glow?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {glow && active && (
        <span
          className="streak-glow pointer-events-none absolute inset-[-40%] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,122,0,0.5) 0%, rgba(255,122,0,0) 62%)" }}
        />
      )}
      <span className={cn("relative block h-full w-full", animated && active && "streak-flicker")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/streak/flame.webp"
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="h-full w-full select-none object-contain transition-[filter,opacity] duration-500"
          style={active ? undefined : { filter: "grayscale(1) brightness(0.72)", opacity: 0.85 }}
        />
      </span>
    </span>
  );
}
