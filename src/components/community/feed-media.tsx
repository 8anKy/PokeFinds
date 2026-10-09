"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ForumImage } from "@/services/community";
import { ImageLightbox } from "@/components/ui/image-lightbox";

export function FeedMedia({ images, href, lightbox = false }: { images: ForumImage[]; href: string; lightbox?: boolean }) {
  const t = useTranslations("LocalStores");
  const available = images.filter(i => i.url);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<number[]>([0]);
  const [open, setOpen] = useState<number | null>(null);
  const [natural, setNatural] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const first = available[0];
  if (!first?.url) return null;
  // En gemensam ram hindrar att bildtext/åtgärder hoppar när nästa foto är
  // stående. Native scroll-snap följer fingret och behåller lodrät sidscroll.
  // Fotot FYLLER ramen (cover) — `contain` i en kvadratisk ram gav svarta fält
  // på sidorna av varje stående mobilfoto. Saknas måtten (alla foton hittills:
  // uppladdningen sparar dem inte) är ramen 4:5 tills första bilden laddat och
  // berättat sina egna proportioner; hela bilden syns alltid i helskärmsvyn.
  const raw = first.width && first.height ? first.width / first.height : natural ?? .8;
  const ratio = Math.max(.8, Math.min(1.91, raw));
  function prepare(at: number) {
    setLoaded(prev => Array.from(new Set([...prev, ...[at - 1, at, at + 1].filter(i => i >= 0 && i < available.length)])));
  }
  function go(at: number) {
    prepare(at);
    track.current?.scrollTo({ left: at * track.current.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  return <div data-swipe-ignore className="relative">
    <div ref={track} data-feed-carousel role="region" aria-label={t("photoAlbum")} tabIndex={available.length > 1 ? 0 : -1}
      className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-surface [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ aspectRatio: ratio }}
      onPointerDown={() => prepare(index)}
      onTouchStart={e => { prepare(index); if (e.touches.length === 1) start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchMove={e => {
        const point = start.current; const touch = e.touches[0];
        if (point && touch && Math.abs(touch.clientX - point.x) > 12 && Math.abs(touch.clientX - point.x) > Math.abs(touch.clientY - point.y)) suppressClickUntil.current = Date.now() + 500;
      }}
      onTouchEnd={() => { if (Date.now() < suppressClickUntil.current) suppressClickUntil.current = Date.now() + 400; start.current = null; }}
      onClickCapture={e => { if (Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); } }}
      onScroll={e => { const next = Math.max(0, Math.min(available.length - 1, Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))); setIndex(next); prepare(next); }}
      onKeyDown={e => { if (e.key === "ArrowRight" && index < available.length - 1) { e.preventDefault(); go(index + 1); } if (e.key === "ArrowLeft" && index > 0) { e.preventDefault(); go(index - 1); } }}>
      {available.map((image, i) => {
        // ⛔ Första bilden ensam före interaktion. Sex img-taggar med lazy i en
        // kort rad gör att webbläsaren ändå hämtar hela serien.
        const photo = loaded.includes(i) ? <img src={image.url!} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover"
          onLoad={i === 0 && !(first.width && first.height) ? e => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h) setNatural(w / h); } : undefined} /> : null;
        const className = "block h-full w-full shrink-0 snap-center snap-always";
        return lightbox ? <button key={image.key} type="button" tabIndex={i === index ? 0 : -1} aria-label={t("readPost")} onClick={() => setOpen(i)} className={className}>{photo}</button> : <Link key={image.key} href={href} tabIndex={i === index ? 0 : -1} aria-label={t("openProfile")} className={className}>{photo}</Link>;
      })}
    </div>
    {available.length > 1 && <>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-surface/75 px-2.5 py-1 text-xs tabular-nums text-ink" aria-label={t("imagePosition", { current: index + 1, total: available.length })}>{index + 1}/{available.length}</span>
      {index > 0 && <button type="button" aria-label={t("previousImage")} onClick={() => go(index - 1)} className="absolute left-2 top-[calc(50%_-_8px)] hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface/75 text-lg text-ink sm:grid">‹</button>}
      {index < available.length - 1 && <button type="button" aria-label={t("nextImage")} onClick={() => go(index + 1)} className="absolute right-2 top-[calc(50%_-_8px)] hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface/75 text-lg text-ink sm:grid">›</button>}
      <div className="flex h-5 items-center justify-center gap-1.5" aria-hidden="true">{available.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-holo-cyan" : "bg-ink-faint/40"}`} />)}</div>
    </>}
    {lightbox && <ImageLightbox images={available.map(i => ({ url: i.url!, alt: "" }))} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />}
  </div>;
}
