"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { resolveTabSwipe } from "@/lib/swipe-gesture";
import type { ForumImage } from "@/services/community";
import { ImageLightbox } from "@/components/ui/image-lightbox";

export function FeedMedia({ images, href, lightbox = false }: { images: ForumImage[]; href: string; lightbox?: boolean }) {
  const t = useTranslations("LocalStores");
  const available = images.filter(i => i.url);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const image = available[Math.min(index, available.length - 1)];
  if (!image?.url) return null;
  const ratio = image.width && image.height ? Math.max(.8, Math.min(1.91, image.width / image.height)) : 1;
  return <div data-swipe-ignore className="relative bg-surface" style={{ touchAction: "pan-y" }}
    onClickCapture={e => { if (Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); } }}
    onTouchStart={e => { if (e.touches.length === 1) start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: e.timeStamp }; }}
    onTouchEnd={e => {
      const point = start.current; start.current = null;
      if (!point || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - point.x; const dy = e.changedTouches[0].clientY - point.y;
      if (Math.abs(dy) >= Math.abs(dx)) return;
      const direction = resolveTabSwipe({ dx, width: e.currentTarget.offsetWidth, velocityPxPerMs: dx / Math.max(1, e.timeStamp - point.at), canPrev: index > 0, canNext: index < available.length - 1 });
      // ⛔ Ett bildsvep kan följas av ett syntetiskt klick i WebView. Det ska
      // aldrig öppna profilen eller ljuslådan när avsikten var nästa bild.
      if (Math.abs(dx) > 12) suppressClickUntil.current = Date.now() + 400;
      if (direction) setIndex(i => i + direction);
    }}>
    {/* En synlig miniatyr i taget. En bildserie ska inte ladda sex original
        per inlägg när användaren bara scrollar förbi första bilden. */}
    {lightbox ? <button type="button" aria-label={t("readPost")} onClick={() => setOpen(index)} className="block w-full" style={{ aspectRatio: ratio }}><img src={image.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" /></button> : <Link href={href} aria-label={t("openProfile")} className="block w-full" style={{ aspectRatio: ratio }}><img src={image.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" /></Link>}
    {lightbox && <ImageLightbox images={available.map(i => ({ url: i.url!, alt: "" }))} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />}
    {available.length > 1 && <>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-surface/75 px-2.5 py-1 text-xs tabular-nums text-ink" aria-label={t("imagePosition", { current: index + 1, total: available.length })}>{index + 1}/{available.length}</span>
      {index > 0 && <button type="button" aria-label={t("previousImage")} onClick={() => setIndex(i => i - 1)} className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface/75 text-lg text-ink">‹</button>}
      {index < available.length - 1 && <button type="button" aria-label={t("nextImage")} onClick={() => setIndex(i => i + 1)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface/75 text-lg text-ink">›</button>}
      <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">{available.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-holo-cyan" : "bg-ink/40"}`} />)}</div>
    </>}
  </div>;
}
