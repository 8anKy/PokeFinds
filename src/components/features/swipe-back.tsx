"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useViewTransitionBack } from "@/lib/use-view-transition-back";

/**
 * Svep åt höger för att gå tillbaka — till Utforska/Portfölj exakt där du var.
 * Sidan följer fingret; vid släpp glider den ut åt höger och destinationen
 * avtäcks UNDER den via en native View Transition (se globals.css). router.back()
 * återställer scrollpositionen, så samma komponent funkar oavsett varifrån
 * produkten öppnades.
 */
export function SwipeBack({ children }: { children: ReactNode }) {
  const router = useRouter();
  const back = useViewTransitionBack();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Bara touch (mobil) — mus/desktop ska inte kapa horisontella drag.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.clientX;
      startY = e.clientY;
      el.style.transition = "none";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      // Vänta tills riktningen är tydlig; bara höger-drag = tillbaka, allt annat
      // (vänster/vertikalt) släpps till native scroll.
      if (axis === null) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = mx > Math.abs(my) ? "x" : "y";
        if (axis !== "x") {
          dragging = false;
          return;
        }
        el.setPointerCapture(e.pointerId);
      }
      dx = Math.max(0, mx); // bara höger
      el.style.transform = `translateX(${dx}px)`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      if (dx > el.offsetWidth / 4) {
        // Lämna over till View Transition: börja sliden där fingret släppte
        // (--vt-x) och nollställ den live-transformen så snapshotten tas i
        // hemläge. Vid avsaknad av VT-stöd faller hooken tillbaka på vanlig nav.
        document.documentElement.style.setProperty("--vt-x", `${dx}px`);
        el.style.transition = "none";
        el.style.transform = "";
        if (window.history.length > 1) back(() => router.back());
        else back(() => router.push("/produkter"));
      } else {
        el.style.transition = "transform 0.25s ease";
        el.style.transform = "";
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [router, back]);

  return (
    <div ref={ref} style={{ touchAction: "pan-y" }}>
      {children}
    </div>
  );
}
