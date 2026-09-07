"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useEventCallback } from "@/hooks/use-event-callback";
import { DIRECTION_PX, shouldCloseSheet } from "@/lib/sheet-drag";
import { resolveTabSwipe, rubberBand } from "@/lib/swipe-gesture";
import { IconX } from "@/components/ui/icons";

export interface LightboxImage {
  url: string;
  alt: string;
}

/**
 * HELSKÄRMSVISNING AV BILDER — appens bildläsare, inte en dialogruta.
 *
 * ⛔ ERSÄTTER MODALEN (ägarbeslut 2026-09-07). En modal ramar in bilden i en ruta
 * med rubrik och ✕ ovanpå en sida som fortfarande syns runtomkring — bilden blir
 * MINDRE, inte större. Här täcker bilden hela skärmen (över flikraden, `z-[80]`),
 * man bläddrar med ett svep i sidled och lämnar med ett svep NEDÅT. Det är gesten
 * folk redan kan från kamerarullen.
 *
 * ⛔ GESTEN ÄR INTE NYSKRIVEN: domarna är repots egna och redan testade —
 * `resolveTabSwipe` (samma tröskel som flik-svepet: en fjärdedel av bredden eller
 * ett snärt) och `shouldCloseSheet` (samma som bottenarkets nedåtdrag). Riktningen
 * låses vid `DIRECTION_PX` (3 px), ALDRIG vid 8: den läxan är betald två gånger i
 * `lib/sheet-drag.ts` — ett långsamt svep passerar webbläsarens egen scrolltröskel
 * först, den tar gesten och skickar touchcancel. Ytan är dessutom `touch-none` +
 * `data-drag-surface`, så varken WebView:n eller studsvakten i pwa-register.tsx
 * har något att ta.
 *
 * ZOOM (2026-09-08): nyp, dubbeltryck (2,5×) och hjul på desktop, tak 4×. Zoomen
 * ligger på ett EGET lager per bild — spårets transform är bläddringen och skrivs
 * flera gånger per bildruta. ⛔ Inzoomad SLUTAR svepet bläddra och stänga: fingret
 * flyttar bilden i stället, annars går det inte att titta på ett hörn utan att byta
 * bild. Panoreringen klamras mot bildens EGNA renderade mått (`object-contain`
 * krymper elementet till bilden), aldrig mot skärmen — annars går ett stående foto
 * att dra ut i två svarta fält. Ny bild ⇒ zoomen nollställs.
 *
 * HISTORIK: en markörpost pushas vid öppning ⇒ Android-bakåt och webbläsarens
 * bakåt stänger BILDEN i stället för att lämna tråden. Samma recept som
 * produkt-overlayn.
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  /** null = stängd. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  return index != null ? (
    <LightboxPanel
      images={images}
      initialIndex={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
    />
  ) : null;
}

const CLOSE_ANIM_MS = 200;
const ZOOM_ANIM_MS = 200;
/** Taket är läsbarhet, inte pixlar: mer än 4× är bara grus på en telefonbild. */
const MAX_SCALE = 4;
/** Nypet får gå UNDER 1× med gummi, men fjädrar tillbaka när fingrarna lyfts. */
const MIN_PINCH_SCALE = 0.6;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 30;
const WHEEL_DIVISOR = 300;

function LightboxPanel({
  images,
  initialIndex,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  initialIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Common");
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // ZOOMEN SITTER PÅ BILDEN, INTE PÅ SPÅRET: spårets transform är bläddringen och
  // skrivs av svepet flera gånger per bildruta. En delad transform hade tvingat
  // varje svep att räkna om zoomen (och tvärtom) — därför ett eget lager per bild.
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const imgRefs = useRef<(HTMLImageElement | null)[]>([]);
  const zoomRef = useRef({ scale: 1, x: 0, y: 0 });
  const [current, setCurrent] = useState(initialIndex);
  /** Bara för UI:t — ritningen går via refen, aldrig via state. */
  const [zoomed, setZoomed] = useState(false);
  const currentRef = useRef(initialIndex);
  currentRef.current = current;

  // onClose är en inline-arrow hos anroparen (ny identitet varje rendering).
  // Stabil identitet här, annars rivs och sätts drag-lyssnarna om mitt i ett svep
  // och gesten fryser — bottenarkets bugg 2026-08-04.
  const close = useEventCallback(onClose);
  const changeIndex = useEventCallback(onIndexChange);

  // ---------- historik: bakåt stänger bilden, inte tråden ----------
  const closedByHistory = useRef(false);
  useEffect(() => {
    window.history.pushState({ foilioLightbox: true }, "", window.location.href);
    const onPop = () => {
      closedByHistory.current = true;
      close();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Bara om markören fortfarande ÄR översta posten: en riktig navigering har
      // ersatt state:t, och då vore back() ett steg bakåt i sidhistoriken.
      const state = window.history.state as { foilioLightbox?: boolean } | null;
      if (!closedByHistory.current && state?.foilioLightbox) window.history.back();
    };
  }, [close]);

  /** Stäng via historiken så markörposten alltid konsumeras. */
  const requestClose = useEventCallback(() => {
    const state = window.history.state as { foilioLightbox?: boolean } | null;
    if (state?.foilioLightbox) window.history.back();
    else close();
  });

  // ---------- tangentbord + låst bakgrund ----------
  useEffect(() => {
    // ⛔ ÅTERSTÄLL DET SOM STOD FÖRUT, inte tomma strängen: läsaren öppnas även
    // INIFRÅN ett bottenark (säljarkets bilder), och arket har redan låst kroppen.
    // Ett blint `= ""` vid stängning låste upp SIDAN BAKOM det öppna arket.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture + stopImmediatePropagation: Escape ska stänga BILDEN, aldrig
        // arket under den (arkets lyssnare sitter också på document och skulle
        // annars hinna först — stopPropagation stoppar inte syskon).
        e.stopImmediatePropagation();
        e.stopPropagation();
        requestClose();
      } else if (e.key === "ArrowRight") {
        setCurrent((i) => Math.min(images.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        setCurrent((i) => Math.max(0, i - 1));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [images.length, requestClose]);

  // Anroparen håller index (den vet vilken bild som öppnades) — håll det i takt.
  useEffect(() => {
    changeIndex(current);
  }, [current, changeIndex]);

  // Spåret följer index när det ändras av tangentbordet; under fingret sätter
  // svepet transformen själv.
  useEffect(() => {
    const track = trackRef.current;
    const root = rootRef.current;
    if (!track || !root) return;
    track.style.transition = "transform 0.25s ease";
    track.style.transform = `translate3d(${-current * root.clientWidth}px, 0, 0)`;
  }, [current]);

  // ---------- zoom ----------
  /** Lägger zoomen på DEN bild som visas (spårets transform är bläddringen). */
  const paintZoom = useEventCallback((animate: boolean) => {
    const slide = slideRefs.current[currentRef.current];
    if (!slide) return;
    const { scale, x, y } = zoomRef.current;
    slide.style.transition = animate ? `transform ${ZOOM_ANIM_MS}ms ease` : "none";
    slide.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  });

  /**
   * Panoreringen får aldrig lämna tomrum: taket räknas på bildens EGNA renderade
   * mått (`object-contain` gör elementets ruta lika stor som bilden), inte på
   * skärmen — annars går ett stående foto att dra ut i två svarta fält.
   */
  const setZoom = useEventCallback((scale: number, x: number, y: number, animate: boolean) => {
    const root = rootRef.current;
    const s = Math.min(MAX_SCALE, Math.max(1, scale));
    let nx = x;
    let ny = y;
    if (s === 1) {
      nx = 0;
      ny = 0;
    } else {
      const img = imgRefs.current[currentRef.current];
      const vw = root?.clientWidth ?? 0;
      const vh = root?.clientHeight ?? 0;
      const maxX = Math.max(0, ((img?.clientWidth ?? vw) * s - vw) / 2);
      const maxY = Math.max(0, ((img?.clientHeight ?? vh) * s - vh) / 2);
      nx = Math.min(maxX, Math.max(-maxX, x));
      ny = Math.min(maxY, Math.max(-maxY, y));
    }
    zoomRef.current = { scale: s, x: nx, y: ny };
    paintZoom(animate);
    setZoomed(s > 1.01);
  });

  // Ny bild ⇒ nollställd zoom. Att bläddra vidare inzoomad landar annars mitt
  // inne i nästa bild, och räknaren säger en sak medan skärmen visar en annan.
  useEffect(() => {
    zoomRef.current = { scale: 1, x: 0, y: 0 };
    setZoomed(false);
    for (const el of slideRefs.current) {
      if (!el) continue;
      el.style.transition = "none";
      el.style.transform = "";
    }
  }, [current]);

  // ---------- svep, nyp och panorering ----------
  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;

    /** swipe = bläddra/stäng, pan = flytta en inzoomad bild, pinch = nyp. */
    let mode: "swipe" | "pan" | "pinch" | null = null;
    let axis: "x" | "y" | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let vx = 0;
    let vy = 0;
    let dx = 0;
    let dy = 0;
    // panorering
    let panStartX = 0;
    let panStartY = 0;
    let panOriginX = 0;
    let panOriginY = 0;
    // nyp
    let pinchDist = 0;
    let pinchScale = 1;
    let pinchMidX = 0;
    let pinchMidY = 0;
    let pinchX = 0;
    let pinchY = 0;
    // dubbeltryck
    let lastTapT = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const width = () => root.clientWidth || 1;

    /** Punkt relativt bildens mitt — zoomen räknas kring den, inte kring hörnet. */
    const center = (x: number, y: number) => {
      const r = root.getBoundingClientRect();
      return { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) };
    };

    const paint = () => {
      track.style.transform = `translate3d(${-currentRef.current * width() + dx}px, ${dy}px, 0)`;
      // Bakgrunden tunnas ut under nedåtdraget så att gesten SYNS vara en
      // stängning — utan det ser det bara ut som att bilden råkat glida.
      const bd = backdropRef.current;
      if (bd) bd.style.opacity = String(Math.max(0.3, 1 - dy / 500));
    };

    /** Dubbeltryck/dubbelklick: in på punkten man pekade på, eller hela vägen ut. */
    const toggleZoomAt = (clientX: number, clientY: number) => {
      const m = center(clientX, clientY);
      if (zoomRef.current.scale > 1) setZoom(1, 0, 0, true);
      else
        setZoom(
          DOUBLE_TAP_SCALE,
          m.x * (1 - DOUBLE_TAP_SCALE),
          m.y * (1 - DOUBLE_TAP_SCALE),
          true
        );
    };

    const beginPan = (x: number, y: number) => {
      mode = "pan";
      panStartX = x;
      panStartY = y;
      panOriginX = zoomRef.current.x;
      panOriginY = zoomRef.current.y;
    };

    const begin = (x: number, y: number, time: number) => {
      // Inzoomad flyttar fingret BILDEN. Att bläddra vidare kräver att man först
      // zoomar ut — annars går det inte att titta på ett hörn utan att byta bild.
      if (zoomRef.current.scale > 1) {
        beginPan(x, y);
        return;
      }
      mode = "swipe";
      axis = null;
      startX = lastX = x;
      startY = lastY = y;
      lastT = time;
      vx = vy = dx = dy = 0;
      track.style.transition = "none";
    };

    /** true = vi äger gesten och anroparen ska blockera native scroll. */
    const move = (x: number, y: number, time: number): boolean => {
      if (mode === "pan") {
        setZoom(
          zoomRef.current.scale,
          panOriginX + (x - panStartX),
          panOriginY + (y - panStartY),
          false
        );
        return true;
      }
      if (mode !== "swipe") return false;
      const ddx = x - startX;
      const ddy = y - startY;
      if (axis === null) {
        if (Math.abs(ddx) < DIRECTION_PX && Math.abs(ddy) < DIRECTION_PX) return false;
        axis = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
      }
      if (time > lastT) {
        vx = (x - lastX) / (time - lastT);
        vy = (y - lastY) / (time - lastT);
        lastX = x;
        lastY = y;
        lastT = time;
      }
      if (axis === "x") {
        const atEdge =
          (ddx > 0 && currentRef.current === 0) ||
          (ddx < 0 && currentRef.current === images.length - 1);
        dx = atEdge ? rubberBand(ddx) : ddx;
        dy = 0;
      } else {
        // Uppåt gör ingenting: det finns inget ovanför bilden att dra fram.
        dy = Math.max(0, ddy);
        dx = 0;
      }
      paint();
      return true;
    };

    const finish = () => {
      if (mode === "pan" || mode === "pinch") {
        // Ett nyp som slutade under 1× fjädrar tillbaka i stället för att lämna
        // bilden hängande i ett halvt läge.
        if (mode === "pinch" && zoomRef.current.scale <= 1.01) setZoom(1, 0, 0, true);
        mode = null;
        return;
      }
      if (mode !== "swipe") return;
      mode = null;
      const settled = axis;
      axis = null;
      if (settled === null) return; // en tapp, ingen riktning att döma

      if (settled === "y" && shouldCloseSheet(dy, vy)) {
        track.style.transition = `transform ${CLOSE_ANIM_MS}ms ease`;
        track.style.transform = `translate3d(${-currentRef.current * width()}px, ${window.innerHeight}px, 0)`;
        const bd = backdropRef.current;
        if (bd) {
          bd.style.transition = `opacity ${CLOSE_ANIM_MS}ms ease`;
          bd.style.opacity = "0";
        }
        window.setTimeout(requestClose, CLOSE_ANIM_MS - 20);
        return;
      }

      let next = currentRef.current;
      if (settled === "x") {
        next += resolveTabSwipe({
          dx,
          width: width(),
          velocityPxPerMs: vx,
          canPrev: currentRef.current > 0,
          canNext: currentRef.current < images.length - 1,
        });
      }
      dx = 0;
      dy = 0;
      const bd = backdropRef.current;
      if (bd) {
        bd.style.transition = "opacity 0.2s ease";
        bd.style.opacity = "1";
      }
      track.style.transition = "transform 0.25s ease";
      if (next === currentRef.current) {
        track.style.transform = `translate3d(${-currentRef.current * width()}px, 0, 0)`;
      } else {
        currentRef.current = next;
        setCurrent(next);
      }
    };

    const startPinch = (touches: TouchList) => {
      mode = "pinch";
      axis = null;
      dx = dy = 0;
      // Andra fingret kan landa MITT i ett svep — snäpp tillbaka spåret till den
      // aktuella bilden, annars nyper man i en bild som står snett.
      track.style.transition = "none";
      track.style.transform = `translate3d(${-currentRef.current * width()}px, 0, 0)`;
      const bd = backdropRef.current;
      if (bd) bd.style.opacity = "1";
      const a = touches[0];
      const b = touches[1];
      pinchDist = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
      const m = center((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinchMidX = m.x;
      pinchMidY = m.y;
      pinchScale = zoomRef.current.scale;
      pinchX = zoomRef.current.x;
      pinchY = zoomRef.current.y;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        startPinch(e.touches);
        return;
      }
      if (e.touches.length !== 1) {
        mode = null;
        return;
      }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (mode === "pinch") {
        if (e.touches.length < 2) return;
        const a = e.touches[0];
        const b = e.touches[1];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const m = center((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        const scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_PINCH_SCALE, (pinchScale * dist) / pinchDist)
        );
        // Punkten mellan fingrarna ska ligga stilla: t = m − (s/s₀)·(m₀ − t₀).
        const k = scale / pinchScale;
        setZoom(scale, m.x - k * (pinchMidX - pinchX), m.y - k * (pinchMidY - pinchY), false);
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      const own = move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
      if (own && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Dubbeltrycket döms FÖRE finish(): efter den är riktningen redan nollad.
      if (mode === "swipe" && axis === null && e.changedTouches.length === 1) {
        const tap = e.changedTouches[0];
        const near =
          Math.abs(tap.clientX - lastTapX) < TAP_SLOP && Math.abs(tap.clientY - lastTapY) < TAP_SLOP;
        if (e.timeStamp - lastTapT < DOUBLE_TAP_MS && near) {
          lastTapT = 0;
          mode = null;
          toggleZoomAt(tap.clientX, tap.clientY);
          return;
        }
        lastTapT = e.timeStamp;
        lastTapX = tap.clientX;
        lastTapY = tap.clientY;
      }
      finish();
      // Ett finger kvar efter ett nyp ⇒ fortsätt som panorering direkt, annars
      // måste man lyfta båda fingrarna för att kunna flytta bilden.
      if (e.touches.length === 1 && zoomRef.current.scale > 1) {
        beginPan(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    // MUS: pointer-events duger på desktop (ingen WebView som avbryter). Touch går
    // uteslutande via touch-events ovan — samma delning som bottenarket.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      begin(e.clientX, e.clientY, e.timeStamp);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      move(e.clientX, e.clientY, e.timeStamp);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      finish();
    };
    const onDoubleClick = (e: MouseEvent) => toggleZoomAt(e.clientX, e.clientY);
    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      const z = zoomRef.current;
      const m = center(e.clientX, e.clientY);
      const next = Math.min(MAX_SCALE, Math.max(1, z.scale * Math.exp(-e.deltaY / WHEEL_DIVISOR)));
      const k = next / z.scale;
      setZoom(next, m.x - k * (m.x - z.x), m.y - k * (m.y - z.y), false);
    };

    // Bredden ligger i transformen (px, inte %): en rotation eller ett omritat
    // fönster måste flytta spåret till samma bild igen.
    const reposition = () => {
      if (mode) return;
      track.style.transition = "none";
      track.style.transform = `translate3d(${-currentRef.current * width()}px, 0, 0)`;
      // Taket för panoreringen räknas om mot den nya bildstorleken.
      const z = zoomRef.current;
      setZoom(z.scale, z.x, z.y, false);
    };
    window.addEventListener("resize", reposition);

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    // Ett avbrott (systemgest, inkommande samtal) döms som ett släpp och lämnar
    // ALDRIG gesten hängande.
    root.addEventListener("touchcancel", finish);
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("dblclick", onDoubleClick);
    root.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("resize", reposition);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", finish);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [images.length, requestClose, setZoom]);

  if (typeof document === "undefined") return null;

  const multiple = images.length > 1;
  const topInset = "calc(env(safe-area-inset-top) + 0.75rem)";

  return createPortal(
    <div
      ref={rootRef}
      // data-drag-surface: studsvakten i pwa-register.tsx måste hålla fingrarna
      // borta — den preventDefault:ar annars vårt nedåtdrag och gesten dör.
      data-drag-surface=""
      className="fixed inset-0 z-[80] touch-none select-none overflow-hidden overscroll-none"
      role="dialog"
      aria-modal="true"
      aria-label={images[Math.min(current, images.length - 1)]?.alt ?? ""}
    >
      <div ref={backdropRef} className="absolute inset-0 bg-black" aria-hidden="true" />

      <div ref={trackRef} className="absolute inset-0 flex will-change-transform">
        {images.map((img, i) => (
          <div
            key={img.url}
            className="flex h-full w-full shrink-0 items-center justify-center overflow-hidden"
          >
            {/* Zoomlagret är EGET: bläddringen skriver spårets transform flera gånger
                per bildruta, och en delad transform hade tvingat varje svep att
                räkna om zoomen. */}
            <div
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="flex h-full w-full items-center justify-center will-change-transform"
            >
              <img
                ref={(el) => {
                  imgRefs.current[i] = el;
                }}
                src={img.url}
                alt={img.alt}
                draggable={false}
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Räknaren uppe till höger, som i kamerarullen — bara när det finns fler. */}
      {multiple && (
        <span
          className="pointer-events-none absolute right-4 z-10 rounded-full bg-black/45 px-2.5 py-1 text-sm font-semibold tabular-nums text-white/90"
          style={{ top: topInset }}
        >
          {current + 1}/{images.length}
        </span>
      )}

      {/* Svep ner är vägen ut på mobil; knappen finns för desktop och skärmläsare. */}
      <button
        type="button"
        onClick={requestClose}
        aria-label={t("close")}
        className="absolute left-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white/90 transition-colors hover:bg-black/70"
        style={{ top: topInset }}
      >
        <IconX size={18} />
      </button>

      {multiple && !zoomed && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center gap-1.5"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          aria-hidden="true"
        >
          {images.map((img, i) => (
            <span
              key={img.url}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                i === current ? "bg-white" : "bg-white/35"
              )}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
