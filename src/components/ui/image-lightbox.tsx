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
  const [current, setCurrent] = useState(initialIndex);
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
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      } else if (e.key === "ArrowRight") {
        setCurrent((i) => Math.min(images.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        setCurrent((i) => Math.max(0, i - 1));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
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

  // ---------- svep ----------
  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;

    let dragging = false;
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

    const width = () => root.clientWidth || 1;

    const paint = () => {
      track.style.transform = `translate3d(${-currentRef.current * width() + dx}px, ${dy}px, 0)`;
      // Bakgrunden tunnas ut under nedåtdraget så att gesten SYNS vara en
      // stängning — utan det ser det bara ut som att bilden råkat glida.
      const bd = backdropRef.current;
      if (bd) bd.style.opacity = String(Math.max(0.3, 1 - dy / 500));
    };

    const begin = (x: number, y: number, time: number) => {
      dragging = true;
      axis = null;
      startX = lastX = x;
      startY = lastY = y;
      lastT = time;
      vx = vy = dx = dy = 0;
      track.style.transition = "none";
    };

    /** true = vi äger gesten och anroparen ska blockera native scroll. */
    const move = (x: number, y: number, time: number): boolean => {
      if (!dragging) return false;
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
      if (!dragging) return;
      dragging = false;
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

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        dragging = false;
        return;
      }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging || e.touches.length !== 1) return;
      const own = move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
      if (own && e.cancelable) e.preventDefault();
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

    // Bredden ligger i transformen (px, inte %): en rotation eller ett omritat
    // fönster måste flytta spåret till samma bild igen.
    const reposition = () => {
      if (dragging) return;
      track.style.transition = "none";
      track.style.transform = `translate3d(${-currentRef.current * width()}px, 0, 0)`;
    };
    window.addEventListener("resize", reposition);

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", finish);
    // Ett avbrott (systemgest, inkommande samtal) döms som ett släpp och lämnar
    // ALDRIG gesten hängande.
    root.addEventListener("touchcancel", finish);
    root.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("resize", reposition);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", finish);
      root.removeEventListener("touchcancel", finish);
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [images.length, requestClose]);

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
        {images.map((img) => (
          <div key={img.url} className="flex h-full w-full shrink-0 items-center justify-center">
            <img
              src={img.url}
              alt={img.alt}
              draggable={false}
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
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

      {multiple && (
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
