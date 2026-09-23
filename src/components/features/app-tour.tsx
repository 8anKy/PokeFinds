"use client";

/**
 * Appens guidade tur — se `lib/app-tour.ts` för stegen och reglerna.
 *
 * Ritas som fyra mörka spärrytor RUNT målet (klick utanför fastnar, resten av skärmen
 * dämpas) + en turkos ring runt hålet. ⛔ Inte en ring med en jätteskugga
 * (`box-shadow: 0 0 0 9999px`) — Chrome ritade den inte alls i mobilvyn (mätt
 * 2026-09-23: skuggan satt i computed style, skärmen var odämpad). Hålet i mitten släpper igenom trycket
 * till det riktiga elementet, så användaren trycker på appens EGEN knapp — turen går
 * vidare när sidan byts / produkten öppnas, inte på ett klick vi fångar. Bottenflikarna
 * navigerar på pointerup, inte click; att lyssna på rutten fångar båda vägarna.
 *
 * ⛔ INGEN DB: tillståndet är en localStorage-nyckel. Monteras i rot-layouten bredvid
 *    BottomTabs; ritar ingenting förrän turen startar.
 * ⛔ FÖRHANDSVISNING (ägarbeslut 2026-09-23): bara admin / `FEATURE_PREVIEW_EMAILS` tills
 *    `FEATURE_APP_TOUR_PUBLIC=1` sätts i Railway. Grinden frågas via /api/feature-preview
 *    (rot-layouten är ISR-cachad och får inte läsa sessionen) — och BARA när turen annars
 *    hade startat, så en vanlig sidvisning kostar ingenting.
 * ⛔ Hittas inte målet inom `TARGET_TIMEOUT_MS` HOPPAS STEGET ÖVER (ingen produkt i
 *    listan efter en filtrering, en flik som saknas) — en mörk skärm utan hål och utan
 *    bubbla är värre än ett överhoppat steg. Sista steget ⇒ turen avslutas.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { onProductOverlayOpen } from "@/lib/product-overlay-open";
import { BrandLogo } from "@/components/layout/brand-logo";
import {
  TOUR_RESTART_PARAM,
  TOUR_START_PATH,
  TOUR_STEPS,
  appTourSeen,
  bubblePlacement,
  isProductPage,
  markAppTourSeen,
  nextStepIndex,
  routeReached,
  visibleStepCount,
  visibleStepNumber,
  type Rect,
} from "@/lib/app-tour";

const TARGET_TIMEOUT_MS = 4_000;
/** Luft mellan målet och ringen. */
const PAD = 6;
const DIM = "pointer-events-auto absolute bg-black/65";

function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function AppTour() {
  const t = useTranslations("Tour");
  const pathname = usePathname();
  const loggedIn = useAuthHint();
  const [step, setStep] = useState<number | null>(null);
  /**
   * VÄLKOMSTSKÄRMEN (ägarbeslut 2026-09-23) — EN skärm före turen, inte tre bilder:
   * turen visar redan hur appen fungerar, så bilder hade upprepat den. Skärmen FRÅGAR
   * i stället för att mörka skärmen oannonserat: "Visa mig runt" startar turen,
   * "Jag klarar mig själv" markerar turen som sedd (den finns kvar i Mer).
   * ⛔ `?guide=1` (Mer → "Visa guiden igen") hoppar över den — där har man redan valt.
   */
  const [welcome, setWelcome] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubbleSize, setBubbleSize] = useState({ width: 300, height: 150 });
  const bubbleRef = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => {
    markAppTourSeen();
    setStep(null);
    setRect(null);
  }, []);

  // Gästläget läses via ref så `next` kan vara stabil (den ligger i effekters deps).
  const guestRef = useRef(true);
  guestRef.current = loggedIn !== true;

  const next = useCallback(() => {
    setRect(null);
    setStep((s) => {
      if (s == null) return s;
      const n = nextStepIndex(s, guestRef.current);
      if (n == null) {
        markAppTourSeen();
        return null;
      }
      return n;
    });
  }, []);

  // ── Start: första besöket på Utforska i mobillayouten, eller ?guide=1 ────
  useEffect(() => {
    if (step != null || welcome || pathname !== TOUR_START_PATH) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const restart = new URLSearchParams(window.location.search).has(TOUR_RESTART_PARAM);
    if (!restart && appTourSeen()) return;
    // Låt sidan rita klart (sökraden, första korten) innan skärmen mörkas — och vänta
    // ut cookie-bannern på mobilwebben: den ligger OVANPÅ bottenflikarna, så turens
    // sista steg (Skanna-fliken) hade inte gått att trycka på. Appen visar ingen banner.
    let waited = 0;
    let allowed: boolean | null = null;
    let cancelled = false;
    fetch("/api/feature-preview?feature=APP_TOUR", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { allowed: false }))
      .then((d: { allowed?: boolean }) => (allowed = d.allowed === true))
      .catch(() => (allowed = false));
    const id = window.setInterval(() => {
      waited += 300;
      if (allowed === false || cancelled) {
        window.clearInterval(id);
        return;
      }
      if (allowed === null || waited < 900 || document.querySelector("[data-cookie-banner]")) return;
      window.clearInterval(id);
      if (restart) setStep(0);
      else setWelcome(true);
    }, 300);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pathname, step, welcome]);

  const current = step != null ? TOUR_STEPS[step] : null;
  const guest = loggedIn !== true;
  const hasTarget = rect !== null;
  const infoOnly = !!current && (current.advance.kind === "next" || (guest && !!current.guestInfoOnly));

  // ── Följ målet: leta tills det finns, mät varje bildruta (scroll, animationer) ──
  useEffect(() => {
    if (!current) return;
    let raf = 0;
    let scrolled = false;
    const started = Date.now();
    const tick = () => {
      const el = findTarget(current.target);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r = el.getBoundingClientRect();
          if (r.top < 60 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: "center" });
        }
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height }
        );
      } else if (Date.now() - started > (current.waitMs ?? TARGET_TIMEOUT_MS)) {
        next();
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [current, next]);

  // ── Gå vidare när användaren gjort det steget ber om ──
  useEffect(() => {
    if (!current || infoOnly) return;
    if (current.advance.kind === "product-open") {
      if (isProductPage(pathname)) next();
      return onProductOverlayOpen(() => next());
    }
    if (routeReached(current.advance, pathname)) next();
  }, [current, infoOnly, pathname, next]);

  // Esc = hoppa över (tangentbord / desktop-webbläsare i smal vy).
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, finish]);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width !== bubbleSize.width || height !== bubbleSize.height) setBubbleSize({ width, height });
    // Bubblans höjd byts med stegets text (och gästtexten) — mät om då.
  }, [step, hasTarget, guest, bubbleSize.width, bubbleSize.height]);

  if (welcome) {
    return (
      <div
        className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-tour-welcome"
      >
        <div className="w-full max-w-sm rounded-3xl border border-surface-border bg-surface-raised p-6 text-center shadow-xl motion-safe:animate-fade-in">
          <BrandLogo className="justify-center" markSize={40} textClass="text-2xl" />
          <h2 id="app-tour-welcome" className="mt-5 text-pretty font-display text-2xl font-bold text-ink">
            {t("welcomeTitle")}
          </h2>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-ink-muted">{t("welcomeBody")}</p>
          <button
            type="button"
            onClick={() => {
              setWelcome(false);
              setStep(0);
            }}
            className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-holo-cyan px-5 text-base font-semibold text-surface transition-colors hover:bg-holo-cyan/90"
          >
            {t("welcomeStart")}
          </button>
          <button
            type="button"
            onClick={() => {
              setWelcome(false);
              markAppTourSeen();
            }}
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center text-sm font-medium text-ink-faint transition-colors hover:text-ink"
          >
            {t("welcomeDismiss")}
          </button>
        </div>
      </div>
    );
  }

  // Målet laddas fortfarande (overlayn hämtar produkten, listan renderar) — rita
  // ingenting än: en mörk skärm utan bubbla ser ut som att appen hängt sig.
  if (!current || step == null || !rect) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const hole = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  const place = bubblePlacement(hole, { width: vw, height: vh }, bubbleSize);
  const copyKey = guest && current.guestCopy ? current.guestCopy : current.copy;
  const last = nextStepIndex(step, guest) == null;

  return (
    // ⛔ Behållaren släpper igenom tryck (pointer-events-none) — annars fångar den
    //    trycket i HÅLET också och målet kan aldrig tryckas. Spärrytorna och bubblan
    //    slår på pointer-events själva.
    <div className="pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={t("label")}>
      {/* Spärrytor runt hålet — dämpar resten av skärmen och fångar tryck utanför målet. */}
      <div className={DIM} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className={DIM} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
      <div className={DIM} style={{ top: hole.top, height: hole.height, left: 0, width: Math.max(0, hole.left) }} />
      <div className={DIM} style={{ top: hole.top, height: hole.height, left: hole.left + hole.width, right: 0 }} />
      {/* Info-steg: även hålet spärras — målet ska visas, inte tryckas. */}
      {infoOnly && <div className="pointer-events-auto absolute" style={hole} />}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-xl ring-2 ring-holo-cyan motion-safe:animate-pulse"
        style={hole}
      />

      <div
        ref={bubbleRef}
        className="pointer-events-auto absolute w-[min(320px,calc(100vw-32px))] rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-xl"
        style={{ top: Math.max(12, Math.min(vh - bubbleSize.height - 12, place.top)), left: place.left }}
      >
        <span
          aria-hidden
          className="absolute h-3 w-3 rotate-45 border-surface-border bg-surface-raised"
          style={
            place.side === "below"
              ? { top: -7, left: place.arrowLeft - 6, borderLeftWidth: 1, borderTopWidth: 1 }
              : { bottom: -7, left: place.arrowLeft - 6, borderRightWidth: 1, borderBottomWidth: 1 }
          }
        />
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-holo-cyan">
          {t("progress", { step: visibleStepNumber(step, guest), total: visibleStepCount(guest) })}
        </div>
        <h2 className="mt-1 text-pretty text-base font-bold leading-snug text-ink">{t(`${copyKey}Title`)}</h2>
        <p className="mt-1 text-pretty text-sm leading-relaxed text-ink-muted">{t(`${copyKey}Body`)}</p>
        {!infoOnly && <p className="mt-2 text-xs font-semibold text-holo-cyan">{t("tapHint")}</p>}
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="min-h-[44px] px-1 text-sm font-medium text-ink-faint transition-colors hover:text-ink"
          >
            {t("skip")}
          </button>
          {infoOnly && (
            <button
              type="button"
              onClick={next}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-holo-cyan px-5 text-sm font-semibold text-surface transition-colors hover:bg-holo-cyan/90"
            >
              {last ? t("done") : t("next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
