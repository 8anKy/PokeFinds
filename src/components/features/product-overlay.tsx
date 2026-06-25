"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ProductDetailData } from "@/services/products";
import { ProductDetailView } from "@/components/features/product-detail-view";

/**
 * Produkt-overlay: öppnar produktdetaljer OVANPÅ den fortfarande monterade
 * listan (Utforska/Portfölj) istället för att navigera bort. Då kan man svepa
 * höger och se den RIKTIGA föregående skärmen glida fram under fingret — och
 * komma tillbaka exakt där man var. Inga route-/layout-ändringar → ISR-cachen
 * och kostnadsmodellen är orörda. Bara touch (mobil/app); desktop navigerar
 * som vanligt till SSR-sidan.
 *
 * Historik: vi pushar en history-post med SAMMA url (bara en markör) → back/svep/
 * Android-bakåt stänger overlayn utan att rendera om listan. Riktiga länk-klick
 * (brödsmula/set/flik) stänger overlayn och navigerar.
 */
function productSlug(href: string | null): string | null {
  if (!href) return null;
  let path = href;
  if (/^https?:\/\//.test(href)) {
    try {
      path = new URL(href).pathname;
    } catch {
      return null;
    }
  }
  const m = path.match(/^\/produkter\/([^/?#]+)$/);
  return m ? m[1] : null;
}

export function ProductOverlayHost() {
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<ProductDetailData | null>(null);
  const slugRef = useRef<string | null>(null);
  const cache = useRef(new Map<string, Promise<ProductDetailData | null>>());
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const fetchDetail = useCallback((s: string) => {
    let p = cache.current.get(s);
    if (!p) {
      p = fetch(`/api/products/${s}/detail`)
        .then((r) => (r.ok ? (r.json() as Promise<ProductDetailData>) : null))
        .catch(() => null);
      cache.current.set(s, p);
    }
    return p;
  }, []);

  const open = useCallback(
    (s: string) => {
      const wasOpen = slugRef.current !== null;
      slugRef.current = s;
      setSlug(s);
      setData(null);
      // En history-markör med SAMMA URL → back/svep stänger utan list-omrendering.
      const here = window.location.href;
      if (wasOpen) window.history.replaceState({ foilioOverlay: true }, "", here);
      else window.history.pushState({ foilioOverlay: true }, "", here);
      void fetchDetail(s).then((d) => {
        if (slugRef.current === s) setData(d);
      });
    },
    [fetchDetail]
  );

  // Mjuk stängning (state only) — historiken hanteras av anroparen.
  const softClose = useCallback(() => {
    slugRef.current = null;
    setSlug(null);
    setData(null);
  }, []);

  // Stäng via historiken (back) → popstate → softClose. Används av svep/Escape/✕.
  const close = useCallback(() => {
    if (slugRef.current !== null) window.history.back();
  }, []);

  // popstate (Android-bakåt, svep-back, browser-back) → stäng.
  useEffect(() => {
    const onPop = () => {
      if (slugRef.current !== null) softClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [softClose]);

  // Riktig route-ändring (programmatisk nav) medan overlay öppen → stäng.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    if (slugRef.current !== null) softClose();
  }, [pathname, softClose]);

  // Klick-delegering: fånga produkt-länkar → öppna overlay. Övriga interna
  // länkar (brödsmula/set/flik) stänger overlayn och navigerar som vanligt.
  // Endast touch — desktop navigerar till SSR-sidan.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const onPointerDown = (e: PointerEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      const s = productSlug(a?.getAttribute("href") ?? null);
      if (s) void fetchDetail(s); // förvärm cachen innan tappet släpps
    };
    // CAPTURE-fas: måste köra FÖRE Next <Link>:s egen onClick (som annars
    // navigerar via routern + preventDefault → vår bubble-listener bommade och
    // overlayn öppnades aldrig). stopPropagation hindrar både routern och
    // webbläsarens default-navigering.
    const onClickCapture = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!a) return;
      const href = a.getAttribute("href");
      const s = productSlug(href);
      if (s) {
        e.preventDefault();
        e.stopPropagation();
        open(s);
      } else if (slugRef.current !== null && href?.startsWith("/")) {
        // Annan intern länk inuti overlayn → stäng och låt navigeringen ske.
        softClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [open, fetchDetail, softClose]);

  // Body-scroll-lås + Escape medan overlay öppen.
  useEffect(() => {
    if (!slug) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [slug, close]);

  // Svep höger för att stänga: panelen följer fingret och avtäcker den riktiga
  // listan under. Axis-detektering → vertikalt = native scroll. Samma känsla som
  // övriga svep. Vid släpp förbi tröskel → glid ut + close() (history.back).
  useEffect(() => {
    if (!slug) return;
    const el = panelRef.current;
    if (!el) return;
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
      if (axis === null) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = mx > Math.abs(my) ? "x" : "y";
        if (axis !== "x") {
          dragging = false;
          return;
        }
        el.setPointerCapture(e.pointerId);
      }
      dx = Math.max(0, mx);
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
        el.style.transition = "transform 0.25s ease";
        el.style.transform = "translateX(110%)";
        window.setTimeout(close, 230);
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
  }, [slug, close]);

  if (!slug) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Produktdetaljer">
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ touchAction: "pan-y" }}
        className="overlay-in absolute inset-0 overflow-y-auto overscroll-contain bg-surface-gradient outline-none"
      >
        {data ? <ProductDetailView data={data} /> : <DetailSkeleton />}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton mt-4 h-9 w-3/4" />
      <div className="skeleton mt-2 h-4 w-1/2" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="skeleton aspect-[4/3] w-full lg:aspect-auto lg:h-72" />
        <div className="skeleton h-72 w-full" />
      </div>
      <div className="skeleton mt-6 h-24 w-full" />
    </div>
  );
}
