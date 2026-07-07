"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import type { ProductDetailData } from "@/services/products";
import { ProductDetailView } from "@/components/features/product-detail-view";
import { SiteHeader } from "@/components/layout/site-header";
import { registerOverlayOpen, notifyProductOverlayOpen } from "@/lib/product-overlay-open";

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
  // Valfritt locale-prefix (/en) framför — engelska URL:er är /en/produkter/...
  const m = path.match(/^(?:\/[a-z]{2})?\/produkter\/([^/?#]+)$/);
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
      notifyProductOverlayOpen();
      panelRef.current?.scrollTo(0, 0); // nytt kort → tillbaka till toppen (namn/bild)
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

  // Registrera den imperativa öppnaren (för kort som navigerar via onClick).
  useEffect(() => {
    registerOverlayOpen(open);
    return () => registerOverlayOpen(null);
  }, [open]);

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

    // TOUCH-events (ej pointer): i iOS-appen (WKWebView) kapar systemets
    // kant-svep (back-gest) annars hela höger-svepet → "stängdes direkt utan att
    // fingret följde". e.preventDefault() på horisontellt touchmove STOPPAR den
    // native gesten OCH ev. horisontell scroll → vår glid vinner. Vertikalt
    // släpps igenom (native scroll). touchmove MÅSTE vara passive:false.
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Hoppa över ytor som äger horisontellt drag själva (pris-grafen) → svepet
      // ska inte stänga overlayn när man scrubbar grafen.
      if ((e.target as HTMLElement | null)?.closest?.("[data-swipe-ignore]")) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      // .overlay-in animation:...both → fill-mode pinnar transform → nolla den.
      el.style.animation = "none";
      el.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (axis === null) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = mx > Math.abs(my) ? "x" : "y";
        if (axis !== "x") {
          dragging = false; // vertikalt → låt native scroll ta över
          return;
        }
      }
      e.preventDefault(); // kapa native kant-svep/scroll, vi äger gesten
      dx = Math.max(0, mx);
      el.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      el.style.transition = "transform 0.25s ease";
      if (dx > el.offsetWidth / 4) {
        el.style.transform = "translateX(110%)";
        window.setTimeout(close, 230);
      } else {
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [slug, close]);

  if (!slug) return null;

  return (
    // z-40 = täcker sidans egen header (annars dubbel header). Bottom-flikarna
    // (också z-40 men SENARE i DOM, se layout.tsx) målas ovanpå → syns/klickbara.
    <div className="fixed inset-0 z-40" role="dialog" aria-label="Produktdetaljer">
      {/* Solid safe-area-remsa (bg-surface, som headern) → täcker sidan bakom så
          inget skiner igenom under klockan. Panelen börjar under remsan. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[env(safe-area-inset-top)] bg-surface"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ touchAction: "pan-y" }}
        className="overlay-in absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] overflow-y-auto overscroll-none bg-surface-gradient pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none"
      >
        <SiteHeader />
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
