"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import type { ForumImage } from "@/services/community";

/**
 * Trådens bilder: en bild visas stor, fler i ett rutnät; tryck öppnar full
 * storlek i en modal. URL:erna är signerade (7 dygn) och deterministiska per
 * timme, så webbläsarens bildcache träffar mellan sidvisningar.
 */
export function ImageGallery({ images }: { images: ForumImage[] }) {
  const t = useTranslations("Forum");
  const [open, setOpen] = useState<number | null>(null);
  const usable = images.filter((i): i is ForumImage & { url: string } => !!i.url);
  if (usable.length === 0) return null;
  const current = open != null ? usable[open] : null;

  return (
    <>
      <div
        className={cn(
          "grid gap-2",
          usable.length === 1 ? "grid-cols-1" : usable.length === 2 ? "grid-cols-2" : "grid-cols-3"
        )}
      >
        {usable.map((img, i) => (
          <button
            key={img.key}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={t("imageAlt", { n: i + 1, total: usable.length })}
            // EN bild: ramen krymper till bildens egen storlek (w-fit + w-auto på
            // bilden) — ett stående foto fick annars ett grått fält på var sida
            // (ägarbeslut 2026-09-03: "make this fit only the image"). Fler bilder:
            // kvadratiska rutor med beskärning som förut.
            // ⛔ CENTRERAD, inte vänsterställd (ägarbeslut 2026-09-03): en ram som
            // krymper till bilden lämnar luft, och all luft hamnade på HÖGER sida
            // (mätt i appen: 298 px bild i 391 px spalt ⇒ 93 px tomt till höger).
            // Det läste som ett layoutfel, inte som ett val.
            className={cn(
              "group relative overflow-hidden rounded-xl bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
              usable.length === 1 ? "w-fit max-w-full justify-self-center" : "aspect-square"
            )}
          >
            <img
              src={img.url}
              alt={t("imageAlt", { n: i + 1, total: usable.length })}
              width={img.width ?? undefined}
              height={img.height ?? undefined}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              // ⛔ TAKET ÄR EN LÄSBARHETSGRÄNS, INTE EN BILDRAM. En mobilskärm i
              // porträtt (9:19,5) är HÖGRE än vyporten, så en skärmdump utan tak
              // sköt trådens rubrik, gilla/spara och svaren under vikten: mätt i
              // appen 2026-09-03 låg bilden på 646 px i en vyport på 923 px och
              // läsaren fick skrolla förbi hela bilden för att nå ett enda svar.
              // 55vh lämnar plats för texten OVANFÖR och åtminstone knappraden
              // UNDER i samma skärm — och gör samtidigt modalen (75vh) till en
              // verklig förstoring i stället för de 5 vh den var förut.
              className={cn(
                "transition-transform duration-300 group-hover:scale-[1.02]",
                usable.length === 1
                  ? "block h-auto max-h-[55vh] w-auto max-w-full"
                  : "h-full w-full object-cover"
              )}
            />
          </button>
        ))}
      </div>

      <Modal
        open={current != null}
        onClose={() => setOpen(null)}
        title={open != null ? t("imageAlt", { n: open + 1, total: usable.length }) : ""}
        className="max-w-3xl"
      >
        {current && (
          <img
            src={current.url}
            alt={t("imageAlt", { n: (open ?? 0) + 1, total: usable.length })}
            className="mx-auto max-h-[75vh] w-auto max-w-full object-contain"
          />
        )}
      </Modal>
    </>
  );
}
