"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Svep åt höger för att gå tillbaka — till Utforska/Portfölj exakt där du var.
 * router.back() återställer scrollpositionen via webbläsarens history, så samma
 * komponent funkar oavsett varifrån produkten öppnades. Följer fingret och
 * glider ut mjukt (transform 0.25s ease) — samma känsla som övriga svep i appen.
 */
export function SwipeBack({ children }: { children: ReactNode }) {
  const router = useRouter();
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
      el.style.transition = "transform 0.25s ease";
      if (dx > el.offsetWidth / 4) {
        el.style.transform = "translateX(110%)";
        window.setTimeout(() => {
          if (window.history.length > 1) router.back();
          else router.push("/produkter");
        }, 230);
      } else {
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
  }, [router]);

  return (
    <div ref={ref} style={{ touchAction: "pan-y" }}>
      {children}
    </div>
  );
}
