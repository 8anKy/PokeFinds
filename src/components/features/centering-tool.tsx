"use client";

/**
 * CENTRERINGSMÄTAREN (2026-10-01, ägarbeslut) — helskärm över användarens eget foto.
 *
 * Åtta stödlinjer: VITA på kortets ytterkant, TURKOSA på ramens innerkant.
 * Användaren drar dem på plats (handtag på varje linje, förstoringsglas under
 * draget, pilknappar för pixelfinjustering) och ser V/H- och Ö/N-andelarna och
 * PSA-taket uppdateras direkt. Matematiken bor i `lib/centering.ts` (ren, testad).
 *
 * ⛔ Ingen AI och inget nätverk — allt räknas på telefonen. Fotot lämnar aldrig
 *    enheten härifrån; det är graderingen som skickar det, som förut.
 * ⛔ Linjerna är vågräta/lodräta mot SKÄRMEN. Ett snett foto räknas fel, därför
 *    "Räta upp"-reglaget: bilden roteras på en canvas (samma mått) och linjernas
 *    andelar betyder samma sak före och efter.
 * ⛔ Portal till body + `data-drag-surface` + `touch-none`, precis som bildläsaren:
 *    utan portalen klipper en transform hos en förälder `fixed`, och utan de två
 *    attributen äter studsvakten i pwa-register.tsx dragen. Bakåt (Android) stänger
 *    mätaren via en historikmarkör i stället för att lämna sidan med fotona.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CircleButton } from "@/components/ui/back-circle";
import { Spinner } from "@/components/ui/spinner";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconRotate, IconX } from "@/components/ui/icons";
import { useEventCallback } from "@/hooks/use-event-callback";
import { cn } from "@/lib/utils";
import {
  clampLine,
  defaultLines,
  formatRatio,
  guessLines,
  isVerticalLine,
  LINE_KEYS,
  measureCentering,
  worstShare,
  type AxisRatio,
  type CenteringLineKey,
  type CenteringLines,
  type CenteringMode,
  type CenteringResult,
  type CenteringSide,
} from "@/lib/centering";

export interface CenteringOutcome {
  side: CenteringSide;
  lines: CenteringLines;
  rotation: number;
  mode: CenteringMode;
  result: CenteringResult;
  /** Kortet utskuret längs ytterlinjerna (JPEG data-URL) — delningsbildens kort. */
  cropDataUrl: string | null;
}

/** Arbetsbildens längsta sida. 1 px = ~0,06 % av kortet — gott om precision. */
const WORK_MAX = 1600;
const LOUPE_SIZE = 132;
const LOUPE_ZOOM = 4;
const ROTATION_MAX = 6;

/**
 * Var på linjen handtaget sitter (andel längs linjen). Utspritt så att inget
 * handtag hamnar ovanpå ett annat i hörnen: ytterlinjernas vid 70 %, innerlinjernas
 * vid 30 %.
 */
function knobAlong(key: CenteringLineKey): number {
  return key.startsWith("outer") ? 0.7 : 0.3;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
}

/** Ritar källan nedskalad och roterad runt mitten, med SAMMA mått som originalet. */
function renderWork(base: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = base.width;
  c.height = base.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(base, -base.width / 2, -base.height / 2);
  return c;
}

function grayOf(canvas: HTMLCanvasElement, maxSide = 600): { gray: Float32Array; w: number; h: number } {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return { gray, w, h };
}

function cropCard(work: HTMLCanvasElement, l: CenteringLines): string | null {
  const x = l.outerLeft * work.width;
  const y = l.outerTop * work.height;
  const w = (l.outerRight - l.outerLeft) * work.width;
  const h = (l.outerBottom - l.outerTop) * work.height;
  if (w < 20 || h < 20) return null;
  const scale = Math.min(1, 900 / w);
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(work, x, y, w, h, 0, 0, c.width, c.height);
  try {
    return c.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}

/** Färgton för en andel mot PSA:s framsidesgränser (bakom: 75/25). */
function shareTone(share: number, side: CenteringSide): string {
  const ten = side === "front" ? 55.5 : 75.5;
  const nine = side === "front" ? 60.5 : 90.5;
  if (share <= ten) return "text-rise";
  if (share <= nine) return "text-holo-cyan";
  return "text-amber-400";
}

export function CenteringTool(props: {
  src: string;
  side: CenteringSide;
  /** Startläge för e-Reader-reglaget (framsidan), t.ex. ur skannerns setnamn. */
  defaultMode: CenteringMode;
  initial?: CenteringOutcome | null;
  onDone: (outcome: CenteringOutcome) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Centering");
  const { side } = props;
  const close = useEventCallback(props.onClose);

  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const [work, setWork] = useState<{ url: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [lines, setLines] = useState<CenteringLines>(props.initial?.lines ?? defaultLines());
  const [rotation, setRotation] = useState(props.initial?.rotation ?? 0);
  const [mode, setMode] = useState<CenteringMode>(props.initial?.mode ?? props.defaultMode);
  const [selected, setSelected] = useState<CenteringLineKey | null>(null);
  const [drag, setDrag] = useState<{ key: CenteringLineKey; along: number; px: number } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  // Portalen kräver document — rendera först efter montering (ingen hydreringskrock).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ---------- historik: bakåt stänger mätaren, inte sidan ----------
  // ⛔ Bakåtsteget vid stängning skjuts upp ett varv: React kör (i dev, StrictMode)
  //    effekten två gånger direkt efter varandra, och ett omedelbart back() hade
  //    poppat markören och stängt mätaren i samma ögonblick som den öppnades.
  const closedByHistory = useRef(false);
  const pendingBack = useRef<number | null>(null);
  useEffect(() => {
    if (pendingBack.current != null) {
      window.clearTimeout(pendingBack.current);
      pendingBack.current = null;
    }
    const state = window.history.state as { foilioCentering?: boolean } | null;
    if (!state?.foilioCentering) {
      window.history.pushState({ foilioCentering: true }, "", window.location.href);
    }
    const onPop = () => {
      closedByHistory.current = true;
      close();
    };
    window.addEventListener("popstate", onPop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = previousOverflow;
      pendingBack.current = window.setTimeout(() => {
        pendingBack.current = null;
        const s = window.history.state as { foilioCentering?: boolean } | null;
        if (!closedByHistory.current && s?.foilioCentering) window.history.back();
      }, 0);
    };
  }, [close]);

  const requestClose = useEventCallback(() => {
    const state = window.history.state as { foilioCentering?: boolean } | null;
    if (state?.foilioCentering) window.history.back();
    else close();
  });

  // ---------- bilden: ladda, skala ner, gissa linjer ----------
  useEffect(() => {
    let alive = true;
    loadImage(props.src)
      .then((img) => {
        if (!alive) return;
        const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const base = document.createElement("canvas");
        base.width = Math.max(1, Math.round(img.naturalWidth * scale));
        base.height = Math.max(1, Math.round(img.naturalHeight * scale));
        base.getContext("2d")!.drawImage(img, 0, 0, base.width, base.height);
        baseRef.current = base;
        const w = renderWork(base, props.initial?.rotation ?? 0);
        workRef.current = w;
        if (!props.initial) {
          const g = grayOf(w);
          setLines(guessLines(g.gray, g.w, g.h));
        }
        w.toBlob((b) => {
          if (!alive || !b) return;
          setWork({ url: URL.createObjectURL(b), w: w.width, h: w.height });
        }, "image/jpeg", 0.92);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // Bara vid montering — källan och startläget är fasta medan mätaren är öppen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Räta upp: rendera om arbetsbilden en kort stund efter att reglaget stannat.
  const firstRotation = useRef(true);
  useEffect(() => {
    if (firstRotation.current) {
      firstRotation.current = false;
      return;
    }
    const base = baseRef.current;
    if (!base) return;
    const id = window.setTimeout(() => {
      const w = renderWork(base, rotation);
      workRef.current = w;
      w.toBlob((b) => {
        if (!b) return;
        setWork({ url: URL.createObjectURL(b), w: w.width, h: w.height });
      }, "image/jpeg", 0.92);
    }, 120);
    return () => window.clearTimeout(id);
  }, [rotation]);

  // Släpp objektadressen när bilden byts och vid avmontering.
  const workUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = workUrlRef.current;
    workUrlRef.current = work?.url ?? null;
    if (prev && prev !== work?.url) URL.revokeObjectURL(prev);
  }, [work]);
  useEffect(() => () => {
    if (workUrlRef.current) URL.revokeObjectURL(workUrlRef.current);
  }, []);

  // ---------- passning: bilden så stor som scenen tillåter ----------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Scenen finns först när portalen monterats.
  }, [mounted]);

  const disp = useMemo(() => {
    if (!work || stage.w === 0 || stage.h === 0) return null;
    const s = Math.min(stage.w / work.w, stage.h / work.h);
    return { w: work.w * s, h: work.h * s };
  }, [work, stage]);

  const result = useMemo(
    () => (work ? measureCentering(lines, work.w, work.h, side, mode) : null),
    [lines, work, side, mode]
  );

  // ---------- drag ----------
  const dragStart = useRef<{ key: CenteringLineKey; start: number; client: number; size: number } | null>(null);

  const onPointerDown = useCallback(
    (key: CenteringLineKey) => (e: ReactPointerEvent<HTMLElement>) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const vertical = isVerticalLine(key);
      dragStart.current = {
        key,
        start: lines[key],
        client: vertical ? e.clientX : e.clientY,
        size: vertical ? box.width : box.height,
      };
      setSelected(key);
      const along = vertical ? (e.clientY - box.top) / box.height : (e.clientX - box.left) / box.width;
      setDrag({ key, along: Math.min(1, Math.max(0, along)), px: vertical ? e.clientX : e.clientY });
    },
    [lines]
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = dragStart.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const vertical = isVerticalLine(d.key);
    const delta = ((vertical ? e.clientX : e.clientY) - d.client) / d.size;
    setLines((prev) => ({ ...prev, [d.key]: clampLine(prev, d.key, d.start + delta) }));
    const along = vertical ? (e.clientY - box.top) / box.height : (e.clientX - box.left) / box.width;
    setDrag({ key: d.key, along: Math.min(1, Math.max(0, along)), px: vertical ? e.clientX : e.clientY });
  }, []);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    setDrag(null);
  }, []);

  const nudge = useCallback(
    (dir: -1 | 1) => {
      if (!selected || !work) return;
      const size = isVerticalLine(selected) ? work.w : work.h;
      setLines((prev) => ({ ...prev, [selected]: clampLine(prev, selected, prev[selected] + dir / size) }));
    },
    [selected, work]
  );

  function done() {
    const w = workRef.current;
    if (!result || !w) return;
    props.onDone({
      side,
      lines,
      rotation,
      mode: side === "front" ? mode : "standard",
      result,
      cropDataUrl: cropCard(w, lines),
    });
    requestClose();
  }

  // ---------- förstoringsglaset ----------
  const loupe = (() => {
    if (!drag || !disp || !work) return null;
    const vertical = isVerticalLine(drag.key);
    const cx = (vertical ? lines[drag.key] : drag.along) * disp.w;
    const cy = (vertical ? drag.along : lines[drag.key]) * disp.h;
    const stageBox = stageRef.current?.getBoundingClientRect();
    // Glaset på motsatt sida om fingret, så det aldrig hamnar under det.
    const fingerLeft = stageBox ? (vertical ? drag.px : stageBox.left + cx) < stageBox.left + stageBox.width / 2 : true;
    const inner = drag.key.startsWith("inner");
    return (
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-3 z-20 overflow-hidden rounded-full shadow-2xl ring-2",
          inner ? "ring-holo-cyan" : "ring-white",
          fingerLeft ? "right-3" : "left-3"
        )}
        style={{
          width: LOUPE_SIZE,
          height: LOUPE_SIZE,
          backgroundColor: "#000",
          backgroundImage: `url(${work.url})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${disp.w * LOUPE_ZOOM}px ${disp.h * LOUPE_ZOOM}px`,
          backgroundPosition: `${LOUPE_SIZE / 2 - cx * LOUPE_ZOOM}px ${LOUPE_SIZE / 2 - cy * LOUPE_ZOOM}px`,
        }}
      >
        <span
          className={cn("absolute", inner ? "bg-holo-cyan" : "bg-white")}
          style={
            vertical
              ? { left: LOUPE_SIZE / 2 - 0.5, top: 0, width: 1, height: LOUPE_SIZE }
              : { top: LOUPE_SIZE / 2 - 0.5, left: 0, height: 1, width: LOUPE_SIZE }
          }
        />
      </div>
    );
  })();

  const verticalSelected = selected ? isVerticalLine(selected) : true;

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      data-drag-surface=""
      className="fixed inset-0 z-[80] flex flex-col bg-black text-ink"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Huvud */}
      <div className="flex shrink-0 items-center gap-3 px-3 py-2">
        <CircleButton label={t("close")} onClick={requestClose}>
          <IconX size={19} />
        </CircleButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{t("title")}</p>
          <p className="truncate text-xs text-ink-muted">{side === "front" ? t("front") : t("back")}</p>
        </div>
        <Button size="sm" onClick={done} disabled={!result}>
          {t("done")}
        </Button>
      </div>

      {/* Scen */}
      <div ref={stageRef} className="relative min-h-0 flex-1 touch-none select-none px-3">
        {failed ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">{t("loadError")}</div>
        ) : !work || !disp ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div ref={boxRef} className="relative" style={{ width: disp.w, height: disp.h }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={work.url} alt="" draggable={false} className="block h-full w-full" />
              {/* Skugga utanför kortet, så ytterkanten syns även mot en ljus bakgrund. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background: "rgba(0,0,0,0.35)",
                  clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${lines.outerLeft * 100}% ${lines.outerTop * 100}%, ${lines.outerLeft * 100}% ${lines.outerBottom * 100}%, ${lines.outerRight * 100}% ${lines.outerBottom * 100}%, ${lines.outerRight * 100}% ${lines.outerTop * 100}%, ${lines.outerLeft * 100}% ${lines.outerTop * 100}%)`,
                }}
              />
              {LINE_KEYS.map((key) => {
                const vertical = isVerticalLine(key);
                const inner = key.startsWith("inner");
                // e-Reader-framsida: innerlinjerna mot punktkodssidorna räknas inte (ytterlinjerna
                // behövs fortfarande — de skär ut kortet till delningsbilden).
                const dimmed = mode === "ereader" && side === "front" && (key === "innerLeft" || key === "innerBottom");
                const active = selected === key;
                const pos = `${lines[key] * 100}%`;
                const along = `${knobAlong(key) * 100}%`;
                return (
                  <div key={key}>
                    {/* Linjen + en bred osynlig träffyta */}
                    <div
                      role="presentation"
                      onPointerDown={onPointerDown(key)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      className={cn("absolute z-10", vertical ? "top-0 h-full w-6 -translate-x-1/2 cursor-ew-resize" : "left-0 h-6 w-full -translate-y-1/2 cursor-ns-resize")}
                      style={vertical ? { left: pos } : { top: pos }}
                    >
                      <span
                        className={cn(
                          "absolute",
                          inner ? "bg-holo-cyan" : "bg-white",
                          dimmed ? "opacity-30" : "opacity-95",
                          active ? "shadow-[0_0_8px_rgba(45,212,191,0.9)]" : "",
                          vertical ? "left-1/2 top-0 h-full -translate-x-1/2" : "top-1/2 left-0 w-full -translate-y-1/2"
                        )}
                        style={vertical ? { width: active ? 2 : 1.5 } : { height: active ? 2 : 1.5 }}
                      />
                    </div>
                    {/* Handtaget */}
                    <button
                      type="button"
                      aria-label={t(`line.${key}`)}
                      onPointerDown={onPointerDown(key)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onFocus={() => setSelected(key)}
                      onKeyDown={(e) => {
                        const dec = vertical ? "ArrowLeft" : "ArrowUp";
                        const inc = vertical ? "ArrowRight" : "ArrowDown";
                        if (e.key === dec || e.key === inc) {
                          e.preventDefault();
                          setSelected(key);
                          const size = vertical ? work.w : work.h;
                          const dir = e.key === dec ? -1 : 1;
                          setLines((prev) => ({ ...prev, [key]: clampLine(prev, key, prev[key] + dir / size) }));
                        }
                      }}
                      className={cn(
                        "absolute z-20 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
                        dimmed && "opacity-40"
                      )}
                      style={vertical ? { left: pos, top: along } : { top: pos, left: along }}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border-2 shadow-lg transition-transform",
                          inner ? "border-holo-cyan bg-black" : "border-white bg-black",
                          active && "scale-125"
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", inner ? "bg-holo-cyan" : "bg-white")} />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {loupe}
      </div>

      {/* Avläsning + kontroller */}
      <div className="shrink-0 space-y-3 border-t border-surface-border bg-black px-4 pb-3 pt-3">
        <Readout result={result} side={side} />

        <div className="flex items-center gap-2">
          {/* Finjustering av vald linje, en bildpixel per tryck */}
          <div className="flex items-center gap-1 rounded-full border border-surface-border p-1">
            <button
              type="button"
              aria-label={t("nudgeLess")}
              disabled={!selected}
              onClick={() => nudge(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface-overlay disabled:opacity-30"
            >
              {verticalSelected ? <IconChevronLeft size={16} /> : <IconChevronUp size={16} />}
            </button>
            <span className="w-24 truncate text-center text-[11px] text-ink-muted">
              {selected ? t(`line.${selected}`) : t("pickLine")}
            </span>
            <button
              type="button"
              aria-label={t("nudgeMore")}
              disabled={!selected}
              onClick={() => nudge(1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface-overlay disabled:opacity-30"
            >
              {verticalSelected ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
            </button>
          </div>
          {side === "front" && (
            <button
              type="button"
              aria-pressed={mode === "ereader"}
              onClick={() => setMode((m) => (m === "ereader" ? "standard" : "ereader"))}
              className={cn(
                "ml-auto rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                mode === "ereader"
                  ? "border-holo-cyan bg-holo-cyan/10 text-holo-cyan"
                  : "border-surface-border text-ink-muted hover:text-ink"
              )}
            >
              {t("ereader")}
            </button>
          )}
        </div>

        <label className="flex items-center gap-3 text-xs text-ink-muted">
          <IconRotate size={16} className="shrink-0" />
          <span className="w-16 shrink-0">{t("straighten")}</span>
          <input
            type="range"
            min={-ROTATION_MAX}
            max={ROTATION_MAX}
            step={0.1}
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
            className="h-1 flex-1 accent-holo-cyan"
          />
          <span className="w-10 shrink-0 text-right tabular-nums">{rotation.toFixed(1)}°</span>
        </label>

        <p className="text-[11px] leading-relaxed text-ink-faint">
          <span className="font-semibold text-white">{t("legendOuter")}</span> · <span className="font-semibold text-holo-cyan">{t("legendInner")}</span>
          {" — "}
          {mode === "ereader" && side === "front" ? t("hintEreader") : t("hint")}
        </p>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}

function Readout({ result, side }: { result: CenteringResult | null; side: CenteringSide }) {
  const t = useTranslations("Centering");
  if (!result) return <div className="h-14" />;
  const cells: { label: string; r: AxisRatio | null }[] = result.topRight
    ? [{ label: t("axisTopRight"), r: result.topRight }]
    : [
        { label: t("axisLeftRight"), r: result.leftRight },
        { label: t("axisTopBottom"), r: result.topBottom },
      ];
  return (
    <div className="flex items-center gap-4">
      {cells.map(({ label, r }) => (
        <div key={label} className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
          <p className={cn("text-2xl font-bold tabular-nums", r ? shareTone(worstShare(r), side) : "text-ink-faint")}>
            {r ? formatRatio(r) : "–"}
          </p>
        </div>
      ))}
      <div className="ml-auto text-right">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{t("capShort")}</p>
        <p className="text-sm font-semibold text-ink">
          {result.psaCap != null ? t("psaCap", { grade: result.psaCap }) : "–"}
        </p>
      </div>
    </div>
  );
}
