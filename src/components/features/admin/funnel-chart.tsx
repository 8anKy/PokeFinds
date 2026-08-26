"use client";

/**
 * Aktiveringstratten. EGEN FIL, och avsiktligt fri från recharts.
 *
 * ⛔ Låg först i `admin-charts.tsx`, vilket tyst gjorde den lata laddningen
 * verkningslös: en statisk import av tratten hade dragit in HELA modulen —
 * recharts inkluderat — i sidans första bundle. Tratten är ren HTML och CSS och
 * ska renderas direkt; det är sidans viktigaste bild och den enda som svarar på
 * "använder folk det de betalar för?".
 */

import { useState } from "react";
import { SINGLE } from "./chart-palette";
import type { FunnelStep } from "@/services/admin/overview";

const nf = new Intl.NumberFormat("sv-SE");

/**
 * Aktiveringstratt. Vågräta staplar — etiketterna är fraser, och en fras läses
 * inte lodrätt.
 *
 * ⛔ Andelen räknas mot FÖRSTA steget, inte mot föregående. "Andel av alla
 * konton" är frågan man faktiskt ställer; kedjade procent döljer var tappet
 * ligger.
 */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.value || 1;
  /**
   * ⛔ HOVER OCH KLICK ÄR TVÅ TILLSTÅND, INTE ETT. Med en enda `active` hann
   * `onMouseEnter` slå på steget innan klicket kom fram — klicket läste då av
   * som "redan aktivt" och stängde av det igen, så på en datormus hände
   * ingenting alls fast kortet lovar "klicka för förklaringen". Klicket NÅLAR
   * fast förklaringen så den ligger kvar när muspekaren flyttas; hovern är bara
   * en förhandsvisning.
   */
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = pinned ?? hovered;

  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const pct = (s.value / top) * 100;
        const prev = i > 0 ? steps[i - 1] : null;
        // ⛔ Tappet mot föregående steg är bara meningsfullt när stegen faktiskt
        // är en delmängd. Vi visar det som en upplysning i tooltipen, aldrig som
        // stapelns längd.
        const dropFromPrev = prev && prev.value > 0 ? 100 - (s.value / prev.value) * 100 : null;
        return (
          <button
            key={s.key}
            type="button"
            onMouseEnter={() => setHovered(s.key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(s.key)}
            onBlur={() => setHovered(null)}
            onClick={() => setPinned((pin) => (pin === s.key ? null : s.key))}
            aria-expanded={active === s.key}
            className="block w-full text-left focus-visible:outline-none"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-ink">{s.label}</span>
              <span className="text-xs tabular-nums text-ink-muted">
                <span className="font-semibold text-ink">{nf.format(s.value)}</span>
                <span className="ml-1.5 text-ink-faint">{pct.toFixed(0)} %</span>
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-overlay">
              <div
                className="h-full rounded-full transition-[width,opacity] duration-300"
                style={{
                  width: `${Math.max(pct, 1)}%`,
                  backgroundColor: SINGLE,
                  opacity: active && active !== s.key ? 0.45 : 1,
                }}
              />
            </div>
            {active === s.key && (
              <p className="mt-1.5 text-xs text-ink-faint">
                {pinned === s.key && (
                  <span aria-hidden className="mr-1 text-holo-cyan">
                    &bull;
                  </span>
                )}
                {s.hint}
                {dropFromPrev != null && dropFromPrev > 0 && (
                  <>
                    {" "}
                    <span className="text-ink-muted">
                      {dropFromPrev.toFixed(0)} % färre än steget ovanför.
                    </span>
                  </>
                )}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
