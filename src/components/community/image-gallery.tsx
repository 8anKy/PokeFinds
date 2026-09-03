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
            className={cn(
              "group relative overflow-hidden rounded-xl bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
              usable.length === 1 ? "max-h-[70vh]" : "aspect-square"
            )}
          >
            <img
              src={img.url}
              alt={t("imageAlt", { n: i + 1, total: usable.length })}
              width={img.width ?? undefined}
              height={img.height ?? undefined}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className={cn(
                "h-full w-full transition-transform duration-300 group-hover:scale-[1.02]",
                usable.length === 1 ? "max-h-[70vh] object-contain" : "object-cover"
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
