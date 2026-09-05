"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { IconSparkle } from "@/components/ui/icons";

/** Max lutning i grader åt varje håll. */
const MAX_TILT = 12;

/**
 * Pro-kortet — ett holografiskt "full art"-kort som lutar under fingret och där
 * foilen, gnistorna och kantljuset följer ljuskällan.
 *
 * Varumärket heter Foilio: kortet ÄR säljargumentet, inte en illustration till det.
 * Kortanatomin är lånad från spelkortet så att en samlare läser det utan copy:
 * namn, "HP" = priset, attacker = förmånerna, sällsynthetsraden = villkoren.
 *
 * Tre ljuskällor, i prioritetsordning:
 *  1. Pekaren (mus och touch — touch ger pointer-events).
 *  2. Gyrot i telefonen (`deviceorientation`): Android fyrar utan att fråga, iOS
 *     kräver `requestPermission()` från en gest — första tryck på kortet frågar.
 *  3. I vila: en långsam svajning så kortet aldrig står stilla i en skärmdump.
 *
 * All rörelse är `transform` + `background-position` (GPU) och stängs av under
 * `prefers-reduced-motion` av den globala regeln i globals.css. Klasserna bor i
 * globals.css (`.holo-card*`) eftersom effekten är lager av blend-modes och
 * keyframes som Tailwind inte uttrycker rent.
 */
export function ProHoloCard({
  size = "hero",
  className,
  showHint = size === "hero",
}: {
  size?: "hero" | "compact";
  className?: string;
  /** "Rör kortet"-raden under kortet; tonas ut vid första beröring. */
  showHint?: boolean;
}) {
  const t = useTranslations("Pricing");
  const moves = t.raw("card.moves") as string[];
  const cardRef = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(true);
  const [touched, setTouched] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gyroAsked = useRef(false);

  /** px/py ∈ [0,1] = var ljuset träffar kortet. */
  const setLight = useCallback((px: number, py: number) => {
    const el = cardRef.current;
    if (!el) return;
    const cx = Math.min(1, Math.max(0, px));
    const cy = Math.min(1, Math.max(0, py));
    el.style.setProperty("--ry", `${((cx - 0.5) * MAX_TILT * 2).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - cy) * MAX_TILT * 2).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(cx * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(cy * 100).toFixed(1)}%`);
    el.style.setProperty("--gx", `${((cx - 0.5) * 44).toFixed(1)}px`);
    el.style.setProperty("--gy", `${((cy - 0.5) * 44).toFixed(1)}px`);
    // Kantljuset roterar mot ljuskällan.
    const ang = (Math.atan2(cy - 0.5, cx - 0.5) * 180) / Math.PI + 90;
    el.style.setProperty("--ang", `${ang.toFixed(1)}deg`);
  }, []);

  const wake = useCallback(() => {
    setIdle(false);
    setTouched(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const rest = useCallback(() => {
    const el = cardRef.current;
    if (el) {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--gx", "0px");
      el.style.setProperty("--gy", "0px");
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 900);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    wake();
    setLight((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  function onPointerDown() {
    // iOS 13+: gyrot är tyst tills sidan frågat, och frågan måste komma ur en gest.
    // Svaret spelar ingen roll här — nekas det fortsätter pekaren styra ljuset.
    if (gyroAsked.current) return;
    gyroAsked.current = true;
    const DOE = (typeof window !== "undefined"
      ? (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
          .DeviceOrientationEvent
      : undefined);
    if (DOE && typeof DOE.requestPermission === "function") {
      DOE.requestPermission().catch(() => undefined);
    }
  }

  // Gyro: telefonens lutning blir ljuskällan. Nollpunkten är telefonen hållen i
  // ~45° framför sig (beta ≈ 45), inte platt på ett bord.
  useEffect(() => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    let active = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const px = 0.5 + Math.max(-1, Math.min(1, e.gamma / 30)) * 0.5;
      const py = 0.5 + Math.max(-1, Math.min(1, (e.beta - 45) / 30)) * 0.5;
      if (!active) {
        active = true;
        setIdle(false);
        setTouched(true);
      }
      setLight(px, py);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [setLight]);

  const hero = size === "hero";

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div style={{ perspective: 900 }}>
        <div
          ref={cardRef}
          role="img"
          aria-label={t("card.aria")}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerLeave={rest}
          onPointerUp={rest}
          onPointerCancel={rest}
          className={cn("holo-card", idle && "holo-card--idle", hero ? "w-[250px]" : "w-[196px]")}
        >
          <div className={cn("holo-card__face flex flex-col", hero ? "p-3.5 pb-3" : "p-3 pb-2.5")}>
            <div className="flex items-baseline justify-between">
              <span className={cn("font-display font-extrabold tracking-[0.02em] text-ink", hero ? "text-[15px]" : "text-[13px]")}>
                {t("card.name")}
              </span>
              <span className={cn("font-display font-extrabold tabular-nums text-holo-cyan", hero ? "text-base" : "text-sm")}>
                {t("card.price")}
                <span className="text-[10px] font-medium text-ink-muted">{t("card.per")}</span>
              </span>
            </div>

            <div className={cn("holo-card__art flex-1", hero ? "my-2.5" : "my-2")}>
              {/* Löv-F-märket, samma fil som headern (public/brand). Ett bokstavs-F
                  här lästes som ett annat varumärkes F (ägaren 2026-09-05). */}
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Mörk platta bakom märket: foilen och märket är samma turkos, så utan
                    den försvann löv-F:et i sin egen glans (ägaren 2026-09-05). Märket
                    ritas dessutom VITT (brightness 0 + invert) med turkos glöd — den
                    enfärgade varianten av märket, läsbar även när foilen sveper över.
                    Ta bort de två första filtren för att få tillbaka det gröna märket. */}
                <span
                  aria-hidden="true"
                  className="absolute rounded-full"
                  style={{
                    width: hero ? 168 : 128,
                    height: hero ? 168 : 128,
                    background:
                      "radial-gradient(circle, rgba(2,7,7,.94) 0%, rgba(2,7,7,.8) 40%, rgba(2,7,7,.35) 62%, transparent 74%)",
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/foilio-mark.png"
                  alt=""
                  width={hero ? 100 : 76}
                  height={hero ? 100 : 76}
                  draggable={false}
                  className="relative select-none"
                  style={{
                    width: hero ? 100 : 76,
                    height: hero ? 100 : 76,
                    filter:
                      "brightness(0) invert(1) drop-shadow(0 0 14px rgba(45,212,191,.9)) drop-shadow(0 6px 26px rgba(45,212,191,.45))",
                  }}
                />
              </div>
            </div>

            <div className="flex justify-between text-[9.5px] uppercase tracking-[0.1em] text-ink-muted">
              <span>{t("card.rarity")}</span>
              <span>{t("card.billing")}</span>
            </div>

            <ul className={cn("flex flex-col", hero ? "mt-2 gap-[5px]" : "mt-1.5 gap-1")}>
              {moves.map((m) => (
                <li key={m} className={cn("flex items-center gap-[7px] font-semibold text-ink", hero ? "text-[11.5px]" : "text-[10.5px]")}>
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rotate-45 rounded-[2px] bg-holo-cyan"
                    style={{ boxShadow: "0 0 8px #2dd4bf" }}
                  />
                  {m}
                </li>
              ))}
            </ul>

            <div className="mt-2 flex justify-between gap-2 border-t border-white/10 pt-[7px] text-[9.5px] text-ink-faint">
              <span className="truncate">{t("card.includes")}</span>
              <span className="shrink-0">{t("card.cancel")}</span>
            </div>
          </div>

          <div className="holo-card__foil" aria-hidden="true" />
          <div className="holo-card__lines" aria-hidden="true" />
          <div className="holo-card__spark" aria-hidden="true" />
          <div className="holo-card__glare" aria-hidden="true" />
          <div className="holo-card__rim" aria-hidden="true" />
        </div>
      </div>

      {showHint && (
        <p
          aria-hidden={touched}
          className={cn(
            "mt-3 flex items-center gap-1.5 text-[11px] text-ink-faint transition-opacity duration-500",
            touched && "opacity-0"
          )}
        >
          <IconSparkle size={13} />
          {t("cardHint")}
        </p>
      )}
    </div>
  );
}
