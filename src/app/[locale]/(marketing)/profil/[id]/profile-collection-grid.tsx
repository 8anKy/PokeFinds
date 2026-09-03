"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { openProductOverlay } from "@/lib/product-overlay-open";
import { IconPackage } from "@/components/ui/icons";

/** En ruta = en VARA (poster hopslagna, se lib/collection-lots). */
export interface ProfileCollectionCell {
  key: string;
  name: string;
  setName: string | null;
  imageUrl: string | null;
  /** Produktsida att inspektera; null = fritextpost utan katalogkoppling. */
  slug: string | null;
  quantity: number;
  /** Öre per exemplar. Skickas BARA för ägaren — andra får aldrig belopp. */
  unitValue: number | null;
}

/**
 * Profilens samlingsrutnät — samma cell som mobilens samlings-rutnät i /samling
 * (bildbrunn, namn, set, värde, antal) men READ-ONLY: inget väljläge, inget
 * köppris, ingen sälj-knapp. Tryck på en ruta öppnar produkten (overlayn på
 * touch, annars produktsidan), precis som i Utforska.
 */
export function ProfileCollectionGrid({
  cells,
  showValues,
}: {
  cells: ProfileCollectionCell[];
  showValues: boolean;
}) {
  const t = useTranslations("Profile");
  const router = useRouter();

  function open(slug: string | null) {
    if (!slug) return;
    if (!openProductOverlay(slug)) router.push(`/produkter/${slug}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cells.map((c) => {
        const clickable = c.slug != null;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => open(c.slug)}
            disabled={!clickable}
            className="card-surface flex flex-col gap-2 p-3 text-left transition-colors enabled:hover:bg-surface-overlay/50 disabled:cursor-default"
          >
            {/* Bildbrunnen är SVART som resten av kortet — samma behandling som
                Utforska-kortet och samlingens rutnät (surface-overlay är en
                interaktiv fyllning, inte en bakgrund). */}
            <div className="h-28 w-full overflow-hidden rounded-lg bg-surface">
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-full object-contain p-1"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-ink-faint">
                  <IconPackage size={26} />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{c.name}</p>
              {c.setName && <p className="truncate text-xs text-ink-muted">{c.setName}</p>}
            </div>
            {(showValues || c.quantity > 1) && (
              <div className="flex items-center justify-between gap-2">
                {showValues && (
                  <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {c.unitValue != null ? formatPrice(c.unitValue) : "–"}
                  </span>
                )}
                {c.quantity > 1 && (
                  <span className="ml-auto text-xs text-ink-muted">
                    {t("pieces", { count: c.quantity })}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
