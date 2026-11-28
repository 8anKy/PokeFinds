"use client";

/**
 * SKANNERN, NYA UTSEENDET — STEG 1 (ägarbeslut 2026-11-28, förhandsvisning `SCANNER_V2`).
 *
 * Två delar som hör ihop:
 *  · `ScanHitMoments` — när en skanning får sitt svar läggs den fångade bilden över kortramen,
 *    tonas ned under en turkos bock med värdet och kortets namn, och flyger sedan ned på HÖGEN i
 *    panelen. Samma sak i Auto och vid ett manuellt tryck.
 *  · `ScanSessionPanel` — panelen som ersätter den vågräta remsan: högen (de tre senaste korten),
 *    senaste kortets rad och sessionens rad ("7 kort · 343 kr · Granska").
 *
 * ⛔ Ett kort syns i panelen först när det LANDAT (`landedIds`) — annars står kortet i raden medan
 * det fortfarande ligger under bocken i ramen. `ScanHitMoments` äger den bokföringen: allt som inte
 * får en animation (återställd bricka, uppladdad bild, reducerad rörelse) landar direkt.
 * ⛔ Ingen räknarbricka på högen (ägaren: "remove the extra number counter") — antalet står i raden under.
 * ⛔ Bara det som rör UTSEENDET bor här. Vad som skannas, kvoten och facit ligger kvar i skannersidan.
 */
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Från och med det här värdet (öre) är ett kort en "Träff" — turkost värde och en glans över kortet. */
export const SCAN_HIT_ORE = 10_000;

/** Priset som det skrivs i nya skannern: hela kronor från 100 kr (ören bär ingen information där), annars som i resten av appen. */
export function scanPrice(ore: number): string {
  if (ore < SCAN_HIT_ORE) return formatPrice(ore);
  return `${String(Math.round(ore / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}\u00a0kr`;
}

/** Det skannersidans poster behöver bära för att ritas här (strukturellt — sidans `ScanItem` passar). */
export interface V2Scan {
  id: string;
  status: "identifying" | "matched" | "choose" | "nomatch" | "error";
  /** Den fångade bilden (data-URL, bara i minnet). */
  captured: string;
  match: { name: string; number: string; setName: string; imageUrl: string | null; estimatedValue: number | null } | null;
  quantity: number;
  errorMessage?: string;
}

/** Syns posten i panelen? Väntande/misslyckade direkt, träffar först när de landat. */
export function scanVisibleInPanel(s: V2Scan, landed: ReadonlySet<string>): boolean {
  if (s.status === "matched" || s.status === "choose") return landed.has(s.id);
  return true;
}

/** Marginalen runt kortet i den fångade bilden (CROP_PAD i skannersidan). */
const CAPTURE_PAD = 0.06;

interface Moment {
  id: string;
  captured: string;
  name: string;
  value: number | null;
  /** "choose" = osäker träff: ingen bock, kortet går bara ned på högen. */
  sure: boolean;
  rect: { left: number; top: number; width: number; height: number };
}

export function ScanHitMoments(props: {
  scans: V2Scan[];
  /** Kortramen i kameravyn — där bilden läggs. */
  frameRef: RefObject<HTMLElement>;
  /** Högen i panelen — dit kortet flyger. */
  pileRef: RefObject<HTMLElement>;
  /** Kortet har landat (eller behövde ingen animation) — nu får panelen visa det. */
  onLanded: (id: string) => void;
}) {
  const { scans, frameRef, pileRef, onLanded } = props;
  const [moments, setMoments] = useState<Moment[]>([]);
  /** Senast sedda status per post. En post som FÖRSTA gången ses färdig (återställd bricka) animeras inte. */
  const seen = useRef(new Map<string, V2Scan["status"]>());
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const started: Moment[] = [];
    for (const s of scans) {
      const before = seen.current.get(s.id);
      seen.current.set(s.id, s.status);
      const resolved = s.status === "matched" || s.status === "choose";
      if (!resolved || before === s.status || before === "matched" || before === "choose") continue;
      const frame = frameRef.current?.getBoundingClientRect();
      // Ingen ram (bulk-läget, uppladdning utanför kameravyn), ingen bild eller första gången vi ser
      // posten: kortet landar direkt.
      if (before !== "identifying" || reduce || !frame || frame.width === 0 || !s.captured) {
        landedRef.current(s.id);
        continue;
      }
      const padX = frame.width * CAPTURE_PAD;
      const padY = frame.height * CAPTURE_PAD;
      started.push({
        id: s.id,
        captured: s.captured,
        name: s.match?.name ?? "",
        value: s.match?.estimatedValue ?? null,
        sure: s.status === "matched",
        rect: { left: frame.left - padX, top: frame.top - padY, width: frame.width + padX * 2, height: frame.height + padY * 2 },
      });
    }
    if (started.length) setMoments((m) => [...m, ...started]);
  }, [scans, frameRef]);

  const finish = (id: string) => {
    landedRef.current(id);
    setMoments((m) => m.filter((x) => x.id !== id));
  };

  if (moments.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40">
      {moments.map((m) => (
        <HitMoment key={m.id} moment={m} pileRef={pileRef} onDone={() => finish(m.id)} />
      ))}
    </div>
  );
}

function HitMoment({ moment, pileRef, onDone }: { moment: Moment; pileRef: RefObject<HTMLElement>; onDone: () => void }) {
  const t = useTranslations("Scanner");
  const boxRef = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const hit = moment.sure && moment.value != null && moment.value >= SCAN_HIT_ORE;

  useEffect(() => {
    // Bocken står kvar en stund (längre vid en träff), sedan flyger kortet till högen.
    const hold = moment.sure ? (hit ? 900 : 680) : 160;
    let anim: Animation | undefined;
    const timer = window.setTimeout(() => {
      setFlying(true);
      const box = boxRef.current;
      const pile = pileRef.current?.getBoundingClientRect();
      if (!box || !pile || pile.width === 0 || typeof box.animate !== "function") {
        doneRef.current();
        return;
      }
      const r = moment.rect;
      const dx = pile.left + pile.width / 2 - (r.left + r.width / 2);
      const dy = pile.top + pile.height / 2 - (r.top + r.height / 2);
      const scale = Math.max(0.08, Math.min(0.5, 40 / r.width));
      anim = box.animate(
        [
          { transform: "translate(0px, 0px) rotate(0deg) scale(0.96)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) rotate(-7deg) scale(${scale})`, opacity: 1, offset: 0.85 },
          { transform: `translate(${dx}px, ${dy}px) rotate(-7deg) scale(${scale})`, opacity: 0 },
        ],
        { duration: 420, easing: "cubic-bezier(.5,0,.8,.5)", fill: "forwards" }
      );
      anim.onfinish = () => doneRef.current();
    }, hold);
    // Skyddsnät: en animation som aldrig blir klar (fliken i bakgrunden) får inte hålla kortet borta.
    const guard = window.setTimeout(() => doneRef.current(), hold + 1500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(guard);
      anim?.cancel();
    };
  }, [moment, pileRef, hit]);

  const r = moment.rect;
  return (
    <div
      ref={boxRef}
      className="absolute overflow-hidden rounded-2xl shadow-[0_24px_50px_-18px_rgba(0,0,0,0.85)]"
      style={{ left: r.left, top: r.top, width: r.width, height: r.height, transform: "scale(0.96)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={moment.captured}
        alt=""
        className="h-full w-full object-cover transition-[filter] duration-200"
        style={{ filter: flying ? "none" : moment.sure ? "brightness(0.42)" : "grayscale(1) brightness(0.6)" }}
      />
      {hit && !flying && (
        <span className="absolute inset-y-[-20%] left-0 w-1/3 animate-[scanv2-sheen_0.5s_ease-in-out_both] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
      )}
      {moment.sure && (
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-3 text-center transition-opacity duration-150",
            flying ? "opacity-0" : "opacity-100"
          )}
        >
          <span className="flex h-24 w-24 animate-[scanv2-pop_0.3s_cubic-bezier(.3,1.3,.5,1)_both] items-center justify-center rounded-full bg-holo-cyan text-black shadow-[0_14px_40px_-8px_rgba(45,212,191,0.7)]">
            <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className="flex animate-[scanv2-rise_0.25s_ease-out_0.06s_both] flex-col items-center gap-0.5 px-3">
            {hit && <span className="text-[13px] font-semibold text-holo-cyan">{t("v2Hit")}</span>}
            {moment.value != null && (
              <span className={cn("text-[34px] font-bold leading-none tracking-tight tabular-nums", hit ? "text-holo-cyan" : "text-ink")}>
                +{scanPrice(moment.value)}
              </span>
            )}
            <span className="max-w-full truncate text-[15px] font-semibold text-ink">{moment.name}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function ScanSessionPanel(props: {
  scans: V2Scan[];
  landedIds: ReadonlySet<string>;
  /** Högens element — `ScanHitMoments` flyger korten hit. */
  pileRef: RefObject<HTMLSpanElement>;
  onOpen: (id: string) => void;
  onReview: () => void;
  /** Gratiskontots rad/räknare överst (skannersidans egen logik) — ritas som den är. */
  header?: ReactNode;
  /** Räknarchip bredvid antalet (gratiskontot i förhandsvisningen). */
  countChip?: ReactNode;
}) {
  const t = useTranslations("Scanner");
  const { scans, landedIds } = props;
  const visible = scans.filter((s) => scanVisibleInPanel(s, landedIds));
  const cards = visible.filter((s) => s.status === "matched" || s.status === "choose");
  const total = cards.reduce((sum, s) => sum + (s.status === "matched" ? (s.match?.estimatedValue ?? 0) * s.quantity : 0), 0);
  const count = cards.reduce((n, s) => n + s.quantity, 0);
  // Raden beskriver det SENASTE som hänt: en väntande skanning (även en träff som ännu ligger under
  // bocken) går före det senast landade kortet.
  const waiting = scans.some((s) => s.status === "identifying" || !scanVisibleInPanel(s, landedIds));
  const last = visible[visible.length - 1] ?? null;
  const pile = cards.slice(-3);
  const pileRotations = ["rotate(-9deg) translate(-7px, 2px)", "rotate(6deg) translate(5px, 0px)", "rotate(-1deg)"];

  // Högen studsar till när ett kort landar.
  const pileEl = props.pileRef;
  const landedCount = cards.length;
  const prevCount = useRef(landedCount);
  useEffect(() => {
    if (landedCount > prevCount.current && typeof pileEl.current?.animate === "function") {
      pileEl.current.animate([{ transform: "scale(1)" }, { transform: "scale(1.14)", offset: 0.45 }, { transform: "scale(1)" }], {
        duration: 350,
        easing: "ease-out",
      });
    }
    prevCount.current = landedCount;
  }, [landedCount, pileEl]);

  let name = "";
  let meta: ReactNode = null;
  let price: ReactNode = null;
  if (scans.length === 0) {
    name = t("v2Empty");
  } else if (waiting || !last) {
    name = t("identifying");
  } else if (last.status === "matched" && last.match) {
    const hit = last.match.estimatedValue != null && last.match.estimatedValue >= SCAN_HIT_ORE;
    name = last.match.name;
    meta = (
      <>
        {hit && <span className="font-semibold text-holo-cyan">{t("v2Hit")} · </span>}#{last.match.number} · {last.match.setName}
      </>
    );
    price = last.match.estimatedValue != null && (
      <span className={hit ? "text-holo-cyan" : "text-ink"}>+{scanPrice(last.match.estimatedValue)}</span>
    );
  } else if (last.status === "choose") {
    name = t("whichCard");
    meta = t("v2Uncertain");
  } else if (last.status === "error" && last.errorMessage) {
    name = last.errorMessage;
  } else {
    name = t("noMatch");
    meta = t("v2NoMatchHint");
  }

  return (
    <div data-no-swipe className="overflow-hidden rounded-3xl border border-white/15 bg-black/60 backdrop-blur-xl">
      {props.header}
      <button
        type="button"
        onClick={() => (last && !waiting ? props.onOpen(last.id) : undefined)}
        className="flex h-[68px] w-full items-center gap-3 px-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
      >
        <span ref={props.pileRef} className={cn("relative block h-14 shrink-0", pile.length === 0 && scans.length === 0 ? "w-0" : "w-[60px]")}>
          {pile.map((s, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={s.id}
              src={s.match?.imageUrl ?? s.captured}
              alt=""
              className={cn("absolute left-[10px] top-px h-[53px] w-[38px] rounded object-cover shadow-[0_2px_6px_rgba(0,0,0,0.6)]", s.status === "choose" && "grayscale")}
              style={{ transform: pileRotations[pileRotations.length - pile.length + i] }}
            />
          ))}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("truncate font-semibold", scans.length === 0 ? "text-[15px] font-normal text-ink-muted" : "text-base text-ink")}>{name}</span>
          {meta && <span className="truncate text-[13px] text-ink-muted">{meta}</span>}
        </span>
        {price && <span className="shrink-0 text-base font-bold tabular-nums">{price}</span>}
      </button>
      <div className="flex h-[50px] items-center justify-between border-t border-white/10 pl-4 pr-2.5">
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tabular-nums text-ink">
          <span className="truncate">
            {count === 0 ? t("v2SessionEmpty") : `${t("v2Cards", { count })} · ${scanPrice(total)}`}
          </span>
          {props.countChip}
        </span>
        <button
          type="button"
          onClick={props.onReview}
          disabled={count === 0}
          className={cn(
            "flex h-11 shrink-0 items-center gap-0.5 pl-3 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan",
            count > 0 ? "text-ink" : "text-ink-faint"
          )}
        >
          {t("v2Review")}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** Statusraden under kortramen: en punkt och en kort text som säger vad kameran väntar på. */
export function ScanStatusLine(props: { text: string; on?: boolean; pulse?: boolean }) {
  return (
    <p className="flex items-center justify-center gap-2 px-4 text-center text-[13px] font-semibold text-ink-muted">
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 shrink-0 rounded-full", props.on ? "bg-holo-cyan" : "bg-white/40", props.pulse && "animate-pulse")}
      />
      <span className="min-w-0">{props.text}</span>
    </p>
  );
}

/** Lägena som ord med en tunn turkos linje under det valda (samma form som flikarna i resten av appen). */
export function ScanModeWords(props: {
  modes: Array<{ key: string; label: string; active: boolean; locked?: boolean }>;
  proLabel: string;
  onPick: (key: string) => void;
}) {
  return (
    <div role="group" className="flex items-center justify-center gap-5">
      {props.modes.map((m) => (
        <button
          key={m.key}
          type="button"
          aria-pressed={m.active}
          onClick={() => props.onPick(m.key)}
          className={cn(
            "flex h-11 items-center gap-1.5 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan",
            m.active ? "text-ink" : "text-ink-muted"
          )}
        >
          <span className={cn("border-b-2 pb-1", m.active ? "border-holo-cyan" : "border-transparent")}>{m.label}</span>
          {m.locked && (
            <span className="rounded bg-holo-cyan/20 px-1.5 py-px text-[10px] font-bold tracking-wide text-holo-cyan">{props.proLabel}</span>
          )}
        </button>
      ))}
    </div>
  );
}
