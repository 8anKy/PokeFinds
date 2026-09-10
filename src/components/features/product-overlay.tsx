"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import type { ProductDetailData } from "@/services/products";
import { ProductDetailView } from "@/components/features/product-detail-view";
import {
  registerOverlayOpen,
  notifyProductOverlayOpen,
  onOverlayElevationChange,
  overlayIsElevated,
} from "@/lib/product-overlay-open";
import { resolveBackSwipe } from "@/lib/swipe-gesture";
import {
  PAGE_ENTER_DURATION_MS,
  pageMotionTransition,
  swipeSettleDuration,
} from "@/lib/page-motion";

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
  const backgroundRef = useRef<{
    element: HTMLElement;
    transform: string;
    transition: string;
    willChange: string;
  } | null>(null);
  const pathname = usePathname();
  // Läses vid montering OCH via prenumeration: skannern kan ha anmält sig före
  // oss, och då räcker inte enbart en framtida händelse.
  const [elevated, setElevated] = useState(overlayIsElevated);

  useEffect(() => onOverlayElevationChange(setElevated), []);

  const prepareBackground = useCallback(() => {
    if (backgroundRef.current) return;
    const element = document.querySelector<HTMLElement>("[data-product-overlay-background]");
    if (!element) return;
    backgroundRef.current = {
      element,
      transform: element.style.transform,
      transition: element.style.transition,
      willChange: element.style.willChange,
    };
    // Börja i sitt riktiga läge. Förskjutningen görs först tillsammans med
    // panelens öppningsanimation; att hoppa direkt till -18 % var snäppet som
    // syntes mellan trycket på kortet och den inkommande produkten.
    element.style.transition = "none";
    element.style.transform = "translateX(0%)";
    element.style.willChange = "transform";
  }, []);

  const moveBackground = useCallback((progress: number, transition = "none") => {
    const background = backgroundRef.current;
    if (!background) return;
    background.element.style.transition = transition;
    background.element.style.transform = `translateX(${-18 * (1 - Math.min(1, progress))}%)`;
  }, []);

  const restoreBackground = useCallback(() => {
    const background = backgroundRef.current;
    if (!background) return;
    background.element.style.transform = background.transform;
    background.element.style.transition = background.transition;
    background.element.style.willChange = background.willChange;
    backgroundRef.current = null;
  }, []);

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
      if (!wasOpen) prepareBackground();
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
    [fetchDetail, prepareBackground]
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
    restoreBackground();
  }, [restoreBackground]);

  useEffect(() => restoreBackground, [restoreBackground]);

  // useLayoutEffect placerar bakgrunden före målningen. Två frames behövs för
  // att webbläsaren säkert ska registrera 0 %-läget innan transitionen till
  // -18 % startar samtidigt som produktpanelen glider in.
  useLayoutEffect(() => {
    if (!slug || !backgroundRef.current) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduceMotion) {
      moveBackground(0);
      return;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        moveBackground(0, pageMotionTransition("transform", PAGE_ENTER_DURATION_MS));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [slug, moveBackground]);

  // Stäng via historiken (back) → popstate → softClose. Används av svep/Escape/✕.
  const close = useCallback(() => {
    if (slugRef.current !== null) window.history.back();
  }, []);

  // Historikmarkören har samma URL som listan. Vid ett färdigt fingersvep kan
  // vi därför visa listan direkt när panelen är utanför skärmen och sedan
  // städa markören. Att vänta på popstate här gjorde returen ryckig på tröga
  // WebViews trots att själva transform-animationen redan var färdig.
  const finishSwipeClose = useCallback(() => {
    if (slugRef.current === null) return;
    softClose();
    window.history.back();
  }, [softClose]);

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
    let startT = 0;
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
      startT = e.timeStamp;
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
      moveBackground(dx / (el.offsetWidth || 1));
    };
    const settle = (completing: boolean) => {
      const width = el.offsetWidth || 1;
      const progress = Math.min(1, dx / width);
      const duration = reduceMotion ? 0 : swipeSettleDuration(progress, completing);
      const panelTransition = pageMotionTransition("transform", duration);
      const backgroundTransition = pageMotionTransition("transform", duration);
      el.style.transition = reduceMotion ? "none" : panelTransition;
      if (completing) {
        el.style.transform = `translateX(${width}px)`;
        moveBackground(1, reduceMotion ? "none" : backgroundTransition);
        window.setTimeout(finishSwipeClose, duration);
      } else {
        el.style.transform = "translateX(0px)";
        moveBackground(0, reduceMotion ? "none" : backgroundTransition);
      }
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      const width = el.offsetWidth || 1;
      const dt = Math.max(1, e.timeStamp - startT);
      settle(resolveBackSwipe({ dx, width, velocityPxPerMs: dx / dt }));
    };

    const onCancel = () => {
      if (!dragging) return;
      dragging = false;
      // ⛔ Ett avbrott från operativsystemet är aldrig ett godkänt släpp. Om
      // touchcancel återanvänder onEnd kan en notis/systemgest stänga produkten.
      if (axis === "x") settle(false);
      else {
        el.style.transition = "none";
        el.style.transform = "";
        moveBackground(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [slug, close, finishSwipeClose, moveBackground]);

  if (!slug) return null;

  return (
    // z-40 = täcker sidans egen header (annars dubbel header). Bottom-flikarna
    // (också z-40 men SENARE i DOM, se layout.tsx) målas ovanpå → syns/klickbara.
    // UNDANTAG: en anmäld helskärmsvärd (skannern, z-[60]) skulle annars måla
    // över oss — se registerFullscreenHost i lib/product-overlay-open.ts.
    <div
      className={elevated ? "fixed inset-0 z-[70]" : "fixed inset-0 z-40"}
      role="dialog"
      aria-label="Produktdetaljer"
    >
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
        className="overlay-in absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] overflow-y-auto overscroll-none bg-surface pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none"
      >
        {/* Inget logotyphuvud i overlayn sedan 2026-09-05 — produktvyn bär sin
            egen flytande bakåtcirkel (router.back() stänger via history-markören
            → listan avtäcks). Svep-gesten är orörd. */}
        {data ? <ProductDetailView data={data} context="overlay" /> : <DetailSkeleton />}
      </div>
    </div>
  );
}

/** Samma siluett som vyns "Hjälte"-layout: scen, ark med titel/pris/knappar/graf. */
function DetailSkeleton() {
  return (
    <div>
      <div className="flex h-[300px] items-center justify-center pt-6">
        <div className="skeleton h-[232px] w-[232px] rounded-xl" />
      </div>
      <div className="relative -mt-5 rounded-t-[24px] border-t border-surface-border bg-surface px-2.5 pt-5">
        <div className="skeleton h-7 w-3/4" />
        <div className="skeleton mt-2 h-4 w-1/2" />
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="skeleton h-3 w-28" />
            <div className="skeleton mt-2 h-9 w-36" />
          </div>
          <div className="skeleton h-6 w-16 rounded-full" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="skeleton h-12 w-full rounded-lg" />
          <div className="skeleton h-12 w-full rounded-lg" />
        </div>
        <div className="skeleton mt-6 h-44 w-full" />
      </div>
    </div>
  );
}
