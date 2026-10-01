"use client";

/**
 * CENTRERINGSMÄTAREN (2026-10-01, ägarbeslut) — helskärm över användarens eget foto.
 *
 * TVÅ STEG (ägarens fältrapport samma dag: "när kortet inte är rakt går linjerna
 * inte att lägga perfekt"):
 *  1. HÖRN — fyra handtag läggs på kortets hörn så att konturen följer de raka
 *     kanterna. Bilden räknas sedan om med en homografi (lib/perspective.ts) så att
 *     kortet blir en exakt rektangel med kortets proportioner (63 × 88 mm). Lutning
 *     OCH perspektiv försvinner — en rotation ensam hade bara tagit lutningen.
 *  2. LINJER — åtta stödlinjer på den raka bilden: VITA på kortets ytterkant,
 *     TURKOSA på ramens innerkant. Förstoringsglas under draget, pilknappar för
 *     pixelfinjustering, V/H och Ö/N plus PSA-taket live (lib/centering.ts).
 *
 * ⛔ Ingen AI och inget nätverk — allt räknas på telefonen.
 * ⛔ Portal till body + `data-drag-surface` + `touch-none`, precis som bildläsaren:
 *    utan portalen klipper en transform hos en förälder `fixed`, och utan de två
 *    attributen äter studsvakten i pwa-register.tsx dragen. Bakåt (Android) stänger
 *    mätaren via en historikmarkör i stället för att lämna sidan med fotona.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CircleButton } from "@/components/ui/back-circle";
import { Spinner } from "@/components/ui/spinner";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconRotate,
  IconX,
} from "@/components/ui/icons";
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
import { homography, quadWidth, straightLayout, warpPerspective, type Pt, type Quad } from "@/lib/perspective";

export interface CenteringOutcome {
  side: CenteringSide;
  /** Hörnen som ANDEL av originalfotots bredd/höjd (medsols från övre vänster). */
  quad: Quad;
  /** Linjerna som andel av den RÄTADE bilden. */
  lines: CenteringLines;
  mode: CenteringMode;
  result: CenteringResult;
  /** Kortet utskuret längs ytterlinjerna (JPEG data-URL) — delningsbildens reserv. */
  cropDataUrl: string | null;
}

/** Arbetsbildens längsta sida. 1 px = ~0,06 % av kortet — gott om precision. */
const WORK_MAX = 1600;
/** Den rätade bildens kortbredd, klampad: skarpt nog, snabbt nog att varpa. */
const STRAIGHT_MIN = 600;
const STRAIGHT_MAX = 1000;
const LOUPE_SIZE = 132;
const LOUPE_ZOOM = 4;

type Step = "corners" | "lines";
interface Img {
  url: string;
  w: number;
  h: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Var på linjen handtaget sitter: ytterlinjernas vid 70 %, innerlinjernas vid 30 %. */
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

function canvasToImg(c: HTMLCanvasElement): Promise<Img> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve({ url: URL.createObjectURL(b), w: c.width, h: c.height }) : reject(new Error("blob"))),
      "image/jpeg",
      0.92
    )
  );
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

/** Startgissning för hörnen: ytterkanterna ur bilden som ett rakt fyrhörn. */
function guessQuad(base: HTMLCanvasElement): Quad {
  const g = grayOf(base);
  const l = guessLines(g.gray, g.w, g.h);
  return [
    { x: l.outerLeft, y: l.outerTop },
    { x: l.outerRight, y: l.outerTop },
    { x: l.outerRight, y: l.outerBottom },
    { x: l.outerLeft, y: l.outerBottom },
  ];
}

/** Räta upp: kortets fyrhörn i originalet → en rak rektangel med marginal. */
function straighten(base: HTMLCanvasElement, quad: Quad): { canvas: HTMLCanvasElement; rect: Rect } | null {
  const srcQuad = quad.map((p) => ({ x: p.x * base.width, y: p.y * base.height })) as Quad;
  const cardW = Math.min(STRAIGHT_MAX, Math.max(STRAIGHT_MIN, quadWidth(srcQuad)));
  const layout = straightLayout(cardW);
  const { x, y, w, h } = layout.rect;
  const dst: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const H = homography(dst, srcQuad);
  if (!H) return null;
  const sctx = base.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  const src = sctx.getImageData(0, 0, base.width, base.height);
  const out = warpPerspective({ data: src.data, width: src.width, height: src.height }, H, layout.width, layout.height);
  const tmp = document.createElement("canvas");
  tmp.width = layout.width;
  tmp.height = layout.height;
  const tctx = tmp.getContext("2d")!;
  const id = tctx.createImageData(layout.width, layout.height);
  id.data.set(out);
  tctx.putImageData(id, 0, 0);
  const c = document.createElement("canvas");
  c.width = layout.width;
  c.height = layout.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(tmp, 0, 0);
  return { canvas: c, rect: layout.rect };
}

/** Linjernas startläge på den raka bilden: ytterlinjerna EXAKT på kortet, innerlinjerna gissade. */
function linesForStraight(c: HTMLCanvasElement, rect: Rect): CenteringLines {
  const W = c.width;
  const H = c.height;
  const outer = {
    outerLeft: rect.x / W,
    outerRight: (rect.x + rect.w) / W,
    outerTop: rect.y / H,
    outerBottom: (rect.y + rect.h) / H,
  };
  const g = grayOf(c);
  const guess = guessLines(g.gray, g.w, g.h);
  // Ram ≈ 4 % av kortet om gissningen hamnar utanför rimligt band (2–9 %).
  const inset = (gv: number, o: number, size: number, dir: 1 | -1) => {
    const d = (gv - o) * dir;
    return d > 0.02 * size && d < 0.09 * size ? gv : o + dir * 0.04 * size;
  };
  const cw = rect.w / W;
  const ch = rect.h / H;
  return {
    ...outer,
    innerLeft: inset(guess.innerLeft, outer.outerLeft, cw, 1),
    innerRight: inset(guess.innerRight, outer.outerRight, cw, -1),
    innerTop: inset(guess.innerTop, outer.outerTop, ch, 1),
    innerBottom: inset(guess.innerBottom, outer.outerBottom, ch, -1),
  };
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

/** Färgton för en andel mot PSA:s gränser (fram 55/45 resp. 60/40, bak 75/25 resp. 90/10). */
function shareTone(share: number, side: CenteringSide): string {
  const ten = side === "front" ? 55.5 : 75.5;
  const nine = side === "front" ? 60.5 : 90.5;
  if (share <= ten) return "text-rise";
  if (share <= nine) return "text-holo-cyan";
  return "text-amber-400";
}

/** Förstoringsglaset: cirkel i hörnet motsatt fingret, med ett hårkors. */
function Loupe(props: {
  img: Img;
  disp: { w: number; h: number };
  /** Punkten i bildens visningspixlar. */
  at: Pt;
  cross: "v" | "h" | "both";
  inner: boolean;
  right: boolean;
}) {
  const { img, disp, at, cross, inner } = props;
  const half = LOUPE_SIZE / 2;
  const tone = inner ? "bg-holo-cyan" : "bg-white";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-3 z-30 overflow-hidden rounded-full shadow-2xl ring-2",
        inner ? "ring-holo-cyan" : "ring-white",
        props.right ? "right-3" : "left-3"
      )}
      style={{
        width: LOUPE_SIZE,
        height: LOUPE_SIZE,
        backgroundColor: "#000",
        backgroundImage: `url(${img.url})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${disp.w * LOUPE_ZOOM}px ${disp.h * LOUPE_ZOOM}px`,
        backgroundPosition: `${half - at.x * LOUPE_ZOOM}px ${half - at.y * LOUPE_ZOOM}px`,
      }}
    >
      {cross !== "h" && (
        <span className={cn("absolute", tone)} style={{ left: half - 0.5, top: 0, width: 1, height: LOUPE_SIZE }} />
      )}
      {cross !== "v" && (
        <span className={cn("absolute", tone)} style={{ top: half - 0.5, left: 0, height: 1, width: LOUPE_SIZE }} />
      )}
    </div>
  );
}

type Drag = { kind: "line"; key: CenteringLineKey; along: number } | { kind: "corner"; i: number };

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
  const straightRef = useRef<HTMLCanvasElement | null>(null);
  const [base, setBase] = useState<Img | null>(null);
  const [straight, setStraight] = useState<Img | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>(props.initial ? "lines" : "corners");
  const [quad, setQuad] = useState<Quad | null>(props.initial?.quad ?? null);
  const [lines, setLines] = useState<CenteringLines>(props.initial?.lines ?? defaultLines());
  const [mode, setMode] = useState<CenteringMode>(props.initial?.mode ?? props.defaultMode);
  const [selected, setSelected] = useState<CenteringLineKey | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [fingerLeft, setFingerLeft] = useState(true);

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

  // ---------- bilderna ----------
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    },
    []
  );

  const buildStraight = useCallback(async (q: Quad, keepLines: CenteringLines | null) => {
    const b = baseRef.current;
    if (!b) return false;
    const s = straighten(b, q);
    if (!s) return false;
    straightRef.current = s.canvas;
    const img = await canvasToImg(s.canvas);
    urls.current.push(img.url);
    setLines(keepLines ?? linesForStraight(s.canvas, s.rect));
    setStraight(img);
    return true;
  }, []);

  useEffect(() => {
    let alive = true;
    loadImage(props.src)
      .then(async (img) => {
        if (!alive) return;
        const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0, c.width, c.height);
        baseRef.current = c;
        setQuad(props.initial?.quad ?? guessQuad(c));
        const b = await canvasToImg(c);
        urls.current.push(b.url);
        if (!alive) return;
        setBase(b);
        if (props.initial) await buildStraight(props.initial.quad, props.initial.lines);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // Bara vid montering — källan och startläget är fasta medan mätaren är öppen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const shown = step === "corners" ? base : straight;
  const disp = useMemo(() => {
    if (!shown || stage.w === 0 || stage.h === 0) return null;
    const s = Math.min(stage.w / shown.w, stage.h / shown.h);
    return { w: shown.w * s, h: shown.h * s };
  }, [shown, stage]);

  const result = useMemo(
    () => (straight ? measureCentering(lines, straight.w, straight.h, side, mode) : null),
    [lines, straight, side, mode]
  );

  async function toLines() {
    if (!quad || busy) return;
    setBusy(true);
    // Låt spinnern ritas innan varpningen tar tråden (~0,1–0,3 s på en telefon).
    await new Promise((r) => window.setTimeout(r, 30));
    const ok = await buildStraight(quad, null).catch(() => false);
    setBusy(false);
    if (ok) {
      setSelected(null);
      setStep("lines");
    }
  }

  // ---------- drag ----------
  const dragStart = useRef<{ start: number | Pt; client: Pt; size: { w: number; h: number } } | null>(null);

  const startDrag = useCallback((e: ReactPointerEvent<HTMLElement>, start: number | Pt) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return null;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { start, client: { x: e.clientX, y: e.clientY }, size: { w: box.width, h: box.height } };
    const stageBox = stageRef.current?.getBoundingClientRect();
    if (stageBox) setFingerLeft(e.clientX < stageBox.left + stageBox.width / 2);
    return box;
  }, []);

  const onLineDown = useCallback(
    (key: CenteringLineKey) => (e: ReactPointerEvent<HTMLElement>) => {
      const box = startDrag(e, lines[key]);
      if (!box) return;
      setSelected(key);
      const vertical = isVerticalLine(key);
      const along = vertical ? (e.clientY - box.top) / box.height : (e.clientX - box.left) / box.width;
      setDrag({ kind: "line", key, along: Math.min(1, Math.max(0, along)) });
    },
    [lines, startDrag]
  );

  const onCornerDown = useCallback(
    (i: number) => (e: ReactPointerEvent<HTMLElement>) => {
      if (!quad) return;
      if (!startDrag(e, { ...quad[i] })) return;
      setDrag({ kind: "corner", i });
    },
    [quad, startDrag]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragStart.current;
      const box = boxRef.current?.getBoundingClientRect();
      if (!d || !box || !drag) return;
      const stageBox = stageRef.current?.getBoundingClientRect();
      if (stageBox) setFingerLeft(e.clientX < stageBox.left + stageBox.width / 2);
      if (drag.kind === "line") {
        const vertical = isVerticalLine(drag.key);
        const delta = vertical ? (e.clientX - d.client.x) / d.size.w : (e.clientY - d.client.y) / d.size.h;
        const key = drag.key;
        setLines((prev) => ({ ...prev, [key]: clampLine(prev, key, (d.start as number) + delta) }));
        const along = vertical ? (e.clientY - box.top) / box.height : (e.clientX - box.left) / box.width;
        setDrag({ kind: "line", key, along: Math.min(1, Math.max(0, along)) });
      } else {
        const s = d.start as Pt;
        const p = {
          x: Math.min(1, Math.max(0, s.x + (e.clientX - d.client.x) / d.size.w)),
          y: Math.min(1, Math.max(0, s.y + (e.clientY - d.client.y) / d.size.h)),
        };
        const i = drag.i;
        setQuad((prev) => (prev ? (prev.map((q, k) => (k === i ? p : q)) as Quad) : prev));
      }
    },
    [drag]
  );

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    setDrag(null);
  }, []);

  const nudge = useCallback(
    (dir: -1 | 1) => {
      if (!selected || !straight) return;
      const size = isVerticalLine(selected) ? straight.w : straight.h;
      setLines((prev) => ({ ...prev, [selected]: clampLine(prev, selected, prev[selected] + dir / size) }));
    },
    [selected, straight]
  );

  function done() {
    const w = straightRef.current;
    if (!result || !w || !quad) return;
    props.onDone({
      side,
      quad,
      lines,
      mode: side === "front" ? mode : "standard",
      result,
      cropDataUrl: cropCard(w, lines),
    });
    requestClose();
  }

  // ---------- ritning ----------
  let loupe: ReactNode = null;
  if (drag && disp && shown) {
    if (drag.kind === "corner" && quad) {
      const p = quad[drag.i];
      loupe = <Loupe img={shown} disp={disp} at={{ x: p.x * disp.w, y: p.y * disp.h }} cross="both" inner right={fingerLeft} />;
    } else if (drag.kind === "line") {
      const vertical = isVerticalLine(drag.key);
      const at = {
        x: (vertical ? lines[drag.key] : drag.along) * disp.w,
        y: (vertical ? drag.along : lines[drag.key]) * disp.h,
      };
      loupe = (
        <Loupe
          img={shown}
          disp={disp}
          at={at}
          cross={vertical ? "v" : "h"}
          inner={drag.key.startsWith("inner")}
          right={fingerLeft}
        />
      );
    }
  }

  let stageContent: ReactNode;
  if (failed) {
    stageContent = <div className="flex h-full items-center justify-center text-sm text-ink-muted">{t("loadError")}</div>;
  } else if (!shown || !disp || busy) {
    stageContent = (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  } else if (step === "corners" && quad) {
    const pts = quad.map((p) => `${p.x * disp.w},${p.y * disp.h}`).join(" ");
    stageContent = (
      <div className="flex h-full w-full items-center justify-center">
        <div ref={boxRef} className="relative" style={{ width: disp.w, height: disp.h }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.url} alt="" draggable={false} className="block h-full w-full" />
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={disp.w} height={disp.h}>
            <path
              d={`M0 0H${disp.w}V${disp.h}H0Z M${pts.split(" ").join(" L")}Z`}
              fill="rgba(0,0,0,0.45)"
              fillRule="evenodd"
            />
            <polygon points={pts} fill="none" stroke="#2dd4bf" strokeWidth={1.5} />
          </svg>
          {quad.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={t(`corner${i}`)}
              onPointerDown={onCornerDown(i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="absolute z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ left: p.x * disp.w, top: p.y * disp.h }}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-2 border-holo-cyan bg-black/70 shadow-lg transition-transform",
                  drag?.kind === "corner" && drag.i === i && "scale-125"
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-holo-cyan" />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  } else {
    stageContent = (
      <div className="flex h-full w-full items-center justify-center">
        <div ref={boxRef} className="relative" style={{ width: disp.w, height: disp.h }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.url} alt="" draggable={false} className="block h-full w-full" />
          {LINE_KEYS.map((key) => {
            const vertical = isVerticalLine(key);
            const inner = key.startsWith("inner");
            // e-Reader-framsida: innerlinjerna mot punktkodssidorna räknas inte (ytterlinjerna
            // behövs fortfarande — de skär ut kortet).
            const dimmed = mode === "ereader" && side === "front" && (key === "innerLeft" || key === "innerBottom");
            const active = selected === key;
            const pos = `${lines[key] * 100}%`;
            const along = `${knobAlong(key) * 100}%`;
            return (
              <div key={key}>
                <div
                  role="presentation"
                  onPointerDown={onLineDown(key)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className={cn(
                    "absolute z-10",
                    vertical
                      ? "top-0 h-full w-6 -translate-x-1/2 cursor-ew-resize"
                      : "left-0 h-6 w-full -translate-y-1/2 cursor-ns-resize"
                  )}
                  style={vertical ? { left: pos } : { top: pos }}
                >
                  <span
                    className={cn(
                      "absolute",
                      inner ? "bg-holo-cyan" : "bg-white",
                      dimmed ? "opacity-30" : "opacity-95",
                      active ? "shadow-[0_0_8px_rgba(45,212,191,0.9)]" : "",
                      vertical ? "left-1/2 top-0 h-full -translate-x-1/2" : "left-0 top-1/2 w-full -translate-y-1/2"
                    )}
                    style={vertical ? { width: active ? 2 : 1.5 } : { height: active ? 2 : 1.5 }}
                  />
                </div>
                <button
                  type="button"
                  aria-label={t(`line.${key}`)}
                  onPointerDown={onLineDown(key)}
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
                      const size = vertical ? shown.w : shown.h;
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
                      "flex h-5 w-5 items-center justify-center rounded-full border-2 bg-black shadow-lg transition-transform",
                      inner ? "border-holo-cyan" : "border-white",
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
    );
  }

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
          <p className="truncate text-xs text-ink-muted">
            {side === "front" ? t("front") : t("back")} · {step === "corners" ? t("stepCorners") : t("stepLines")}
          </p>
        </div>
        {step === "corners" ? (
          <Button size="sm" onClick={() => void toLines()} disabled={!quad || !base} loading={busy}>
            {t("next")}
          </Button>
        ) : (
          <Button size="sm" onClick={done} disabled={!result}>
            {t("done")}
          </Button>
        )}
      </div>

      {/* Scen */}
      <div ref={stageRef} className="relative min-h-0 flex-1 touch-none select-none px-3">
        {stageContent}
        {loupe}
      </div>

      {/* Kontroller */}
      <div className="shrink-0 space-y-3 border-t border-surface-border bg-black px-4 pb-3 pt-3">
        {step === "corners" ? (
          <p className="text-[12px] leading-relaxed text-ink-muted">{t("hintCorners")}</p>
        ) : (
          <>
            <Readout result={result} side={side} />
            <div className="flex flex-wrap items-center gap-2">
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
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setStep("corners");
                }}
                className="flex items-center gap-1.5 rounded-full border border-surface-border px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink"
              >
                <IconRotate size={14} /> {t("editCorners")}
              </button>
              {side === "front" && (
                <button
                  type="button"
                  aria-pressed={mode === "ereader"}
                  onClick={() => setMode((m) => (m === "ereader" ? "standard" : "ereader"))}
                  className={cn(
                    "ml-auto rounded-full border px-3 py-2 text-xs font-semibold transition-colors",
                    mode === "ereader"
                      ? "border-holo-cyan bg-holo-cyan/10 text-holo-cyan"
                      : "border-surface-border text-ink-muted hover:text-ink"
                  )}
                >
                  {t("ereader")}
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              <span className="font-semibold text-white">{t("legendOuter")}</span> ·{" "}
              <span className="font-semibold text-holo-cyan">{t("legendInner")}</span>
              {" — "}
              {mode === "ereader" && side === "front" ? t("hintEreader") : t("hint")}
            </p>
          </>
        )}
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
