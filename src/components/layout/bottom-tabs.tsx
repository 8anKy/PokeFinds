"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { hapticGlide, hapticTick } from "@/lib/haptics";
import { isEmailLandingRoute } from "@/lib/auth-routes";
import { hidesBottomTabs } from "@/lib/immersive-routes";
import { useCommunityV2 } from "@/lib/use-community-v2";
import { rubberBand } from "@/lib/swipe-gesture";
import {
  IconSearch,
  IconPackage,
  IconCamera,
  IconMessage,
  IconMenu,
  type IconProps,
} from "@/components/ui/icons";

const TABS: { href: string; key: string; icon: (p: IconProps) => JSX.Element }[] = [
  { href: "/produkter", key: "explore", icon: IconSearch },
  { href: "/samling", key: "portfolio", icon: IconPackage },
  { href: "/skanna", key: "scan", icon: IconCamera },
  { href: "/community", key: "community", icon: IconMessage },
  { href: "/mer", key: "more", icon: IconMenu },
];

/** Luft mellan markören och flikrutans kant (px) — se markörens kommentar nedan. */
const MARKER_GAP = 5;

export function BottomTabs() {
  const tNav = useTranslations("Nav");
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; x: number; index: number; dragging: boolean; pathname: string; rect: DOMRect } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ index: number; position: number; edge: number; width: number } | null>(null);
  // Vilken flik trycket VALDE, tills rutten hunnit fram. Utan den hoppar
  // markören tillbaka till den gamla fliken i väntan på navigeringen och glider
  // först när sidan bytts — trycket kändes då som ett ryck i fel riktning.
  const [pending, setPending] = useState<number | null>(null);
  // Forumet (community v2) är grindat tills ägaren testat — se lib/community-v2-gate.ts.
  // Fliken byter mål/etikett Community → Forum bara för den som släpps in.
  const communityV2 = useCommunityV2();
  const tabs = communityV2
    ? TABS.map((t) => (t.key === "community" ? { ...t, href: "/forum", key: "forum" } : t))
    : TABS;
  const activeIndex = tabs.findIndex((tab) => pathname === tab.href || pathname?.startsWith(`${tab.href}/`));
  const selectedIndex = preview?.index ?? pending ?? activeIndex;
  // Markörens läge i flikar (kan vara brutet mitt i ett drag).
  const markerPosition = preview?.position ?? pending ?? Math.max(0, activeIndex);

  function cancelGlide() {
    if (gesture.current) suppressClick.current = true;
    gesture.current = null;
    setPreview(null);
  }

  useEffect(() => {
    // En snabb ny touch kan börja innan föregående navigerings effekt körs.
    // Avbryt bara gester som faktiskt började på den gamla sidan.
    if (gesture.current && gesture.current.pathname !== pathname) cancelGlide();
    // Rutten har landat (eller omdirigerats) — låt den riktiga fliken styra igen.
    setPending(null);
  }, [pathname]);

  function moveGlide(event: PointerEvent<HTMLUListElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.dragging && Math.abs(event.clientX - current.x) < 6) return;
    current.dragging = true;
    suppressClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Mät mot den stilla ramen, aldrig den töjda ytan: annars flyttar draget
    // sina egna träffgränser och markören börjar darra vid ändarna.
    const rect = current.rect;
    if (event.clientY < rect.top - 24 || event.clientY > rect.bottom + 24 ||
        event.clientX < rect.left - 24 || event.clientX > rect.right + 24) {
      setPreview(null);
      return;
    }
    const tabWidth = rect.width / tabs.length;
    const rawPosition = (event.clientX - rect.left) / tabWidth - 0.5;
    const position = Math.max(0, Math.min(tabs.length - 1, rawPosition));
    const edge = Math.max(-12, Math.min(12, rubberBand((rawPosition - position) * tabWidth)));
    const index = Math.round(position);
    if (index !== current.index) hapticGlide();
    current.index = index;
    setPreview({ index, position, edge, width: rect.width });
  }
  // Tab-baren visas alltid (in- som utloggad) — den är appens primära navigering.
  // Skyddade tabbar (Portfölj/Skanna) skickar utloggade till login via middleware.

  // iOS-tangentbordet flyttar position:fixed-element när det öppnas → göm tab-baren
  // medan tangentbordet är uppe. visualViewport krymper när tangentbordet visas
  // (mer pålitligt än focus-event i WebView:en).
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboard(window.innerHeight - vv.height > 120);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (keyboard) cancelGlide();
  }, [keyboard]);

  if (keyboard) return null;
  // Återställ lösenord / verifiera e-post nås via e-postlänk i Safari (inte appen)
  // → visa ingen app-navigering, den lockar bara användaren att browsa webben.
  if (isEmailLandingRoute(pathname)) return null;
  // Inne i ett samtal / en tråd äger innehållet hela skärmen — se lib/immersive-routes.ts.
  if (hidesBottomTabs(pathname)) return null;
  // Auth/onboarding: VISA tab-baren (så man kan tabba vidare även från login) men
  // UTAN klarerings-spacern — den fixerade login-sidan (h-[100dvh]) scrollar annars.
  const noSpacer = ["/logga-in", "/registrera", "/glomt-losenord", "/aterstall-losenord", "/verifiera", "/onboarding"];
  const hideSpacer = noSpacer.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
  return (
    <>
      {/* Klarering: fixed nav överlappar sidans botten — denna spacer ger
          scroll-utrymme så sista innehållet inte göms (ersätter layoutens pb-20). */}
      {!hideSpacer && <div aria-hidden className="h-[var(--bottom-tabs-space)] lg:hidden" />}
      <nav
        ref={navRef}
        aria-label="Huvudnavigering"
        className="fixed inset-x-[18px] bottom-[calc(0.5rem_+_env(safe-area-inset-bottom))] z-40 mx-auto h-14 max-w-[420px] lg:hidden"
      >
      <ul
        data-drag-surface
        className={cn(
          "relative flex h-full touch-none select-none items-stretch rounded-full border border-ink/20 bg-surface/70 shadow-lg shadow-surface/60 backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-500 ease-spring motion-reduce:!transform-none motion-reduce:transition-none [-webkit-touch-callout:none]",
          preview && "duration-75 ease-out"
        )}
        style={{ transform: preview
          ? `translateX(${preview.edge / 2}px) scaleX(${1 + Math.abs(preview.edge) / preview.width}) scaleY(${1.06 - Math.abs(preview.edge) / 400})`
          : "translateX(0px) scaleX(1) scaleY(1)" }}
        onPointerDown={(event) => {
          if (!event.isPrimary) { cancelGlide(); return; }
          if (event.button !== 0) return;
          suppressClick.current = false;
          const rect = navRef.current!.getBoundingClientRect();
          const index = Math.min(tabs.length - 1, Math.max(0,
            Math.floor((event.clientX - rect.left) / (rect.width / tabs.length))));
          // ⛔ Markören flyttas INTE av att man sätter ner fingret: den ska glida
          // dit vid SLÄPPET. Draget tar över först när fingret rört sig (moveGlide).
          const start = pending ?? (activeIndex >= 0 ? activeIndex : index);
          gesture.current = { id: event.pointerId, x: event.clientX, index: start, dragging: false, pathname, rect };
          setPreview({ index: start, position: start, edge: 0, width: rect.width });
        }}
        onPointerMove={moveGlide}
        onPointerUp={(event) => {
          const current = gesture.current;
          if (!current || current.id !== event.pointerId) return;
          // Navigera först vid släpp: annars kan en passage över Skanna starta
          // kameran och skyddade flikar skicka gästen till inloggningen mitt i draget.
          const rect = current.rect;
          const inside = event.clientY >= rect.top - 24 && event.clientY <= rect.bottom + 24 &&
            event.clientX >= rect.left - 24 && event.clientX <= rect.right + 24;
          if (inside && (current.dragging || event.pointerType === "touch")) {
            // Efter ett drag kan webbläsaren utelämna nästa syntetiska click.
            // Touch väljer därför på pointerup; undertryck ett eventuellt click
            // så samma tryck inte ger två navigeringar eller två haptik-tick.
            suppressClick.current = true;
            const index = Math.max(0, Math.min(tabs.length - 1,
              Math.floor((event.clientX - rect.left) / (rect.width / tabs.length))));
            if (index !== activeIndex) {
              if (!current.dragging) hapticTick();
              setPending(index);
              router.push(tabs[index].href);
            }
          }
          gesture.current = null;
          setPreview(null);
        }}
        onPointerCancel={cancelGlide}
        onLostPointerCapture={(event) => {
          // Touch börjar med implicit capture på ikonen/länken. När raden tar
          // över bubblar barnets lost-event hit; det får inte avbryta draget.
          if (event.target === event.currentTarget) cancelGlide();
        }}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => { if (gesture.current) event.preventDefault(); }}
        onClickCapture={(event) => {
          // Webbläsaren skickar även click efter ett drag. Låt inte ursprungs-
          // länken navigera en andra gång; tangentbordets click ska fungera.
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {/* Markören är MARGINALSATT i sin flikruta (MARKER_GAP px på var sida), så
            den aldrig ligger dikt an mot barens kant i vila — kanten är en ram,
            inte en vägg. Bredden krymps med 2×gap och läget räknas därför mot
            (100% + 2×gap) = en hel flikruta, så mitten fortfarande är flikens mitt. */}
        <li aria-hidden className={cn(
          "pointer-events-none absolute inset-y-1 left-0 rounded-full border border-ink/10 bg-ink/20 transition-[transform,opacity] duration-300 ease-out-soft motion-reduce:transition-none",
          selectedIndex < 0 && "opacity-0",
          preview && "duration-75"
        )} style={{
          width: `calc(${100 / tabs.length}% - ${MARKER_GAP * 2}px)`,
          transform: `translateX(calc(${markerPosition} * (100% + ${MARKER_GAP * 2}px) + ${MARKER_GAP}px))`,
        }} />
        {tabs.map((t, index) => {
          const active = pathname === t.href || pathname?.startsWith(`${t.href}/`);
          const highlighted = index === selectedIndex;
          return (
            <li key={t.href} className="relative min-w-0 flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                // Taktil kvittens på flikbytet. ⛔ BARA när fliken FAKTISKT
                // byts: ett tryck på den flik man redan står på navigerar
                // ingenstans, och en vibration då läser som att något hände.
                // Ligger på onClick (inte pointerdown) så en avbruten gest —
                // finger som glider bort från fliken — inte vibrerar.
                onClick={() => {
                  if (active) return;
                  hapticTick();
                  setPending(index);
                }}
                className={cn(
                  "group flex h-full items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan motion-reduce:transition-none",
                  highlighted ? "text-holo-cyan" : "text-ink-muted hover:text-ink"
                )}
              >
                {/* Den gemensamma markören följer fingret över hela flikraden. */}
                <span
                  className={cn(
                    "flex h-8 w-10 items-center justify-center rounded-full transition-transform duration-150 motion-reduce:transition-none",
                    preview && highlighted && "scale-110"
                  )}
                >
                  <t.icon
                    size={24}
                    className={cn(
                      "shrink-0 transition-transform duration-150 group-active:scale-90",
                      active && !preview && "motion-safe:animate-tab-pop"
                    )}
                  />
                </span>
                <span className="sr-only">{tNav(t.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      </nav>
    </>
  );
}
