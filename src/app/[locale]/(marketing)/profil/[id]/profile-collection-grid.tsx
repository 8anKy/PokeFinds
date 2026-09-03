"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { formatPrice } from "@/lib/format";
import { openProductOverlay } from "@/lib/product-overlay-open";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconMail, IconPackage } from "@/components/ui/icons";

/** En ruta = en VARA (poster hopslagna, se lib/collection-lots). */
export interface ProfileCollectionCell {
  key: string;
  /** Första postens CollectionItem-id — det köpförfrågan pekar på. */
  itemId: string;
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
 * köppris, ingen sälj-knapp. Tryck på bilden/namnet öppnar produkten (overlayn
 * på touch, annars produktsidan), precis som i Utforska.
 *
 * `ask` (ägarens id) slår på "Är den till salu?" under varje ruta: EN server-
 * rundtur (/api/chat/ask-item) som öppnar parets chatt, skickar den automatiska
 * frågan (push till ägaren om hen inte är inne) och tar frågaren dit. Sidan
 * avgör om knappen ska finnas (inloggad, inte ägaren, ägaren tillåter det).
 */
export function ProfileCollectionGrid({
  cells,
  showValues,
  ask,
}: {
  cells: ProfileCollectionCell[];
  showValues: boolean;
  ask?: { ownerId: string };
}) {
  const t = useTranslations("Profile");
  const router = useRouter();
  const { toast } = useToast();
  const [askingKey, setAskingKey] = useState<string | null>(null);

  function open(slug: string | null) {
    if (!slug) return;
    if (!openProductOverlay(slug)) router.push(`/produkter/${slug}`);
  }

  async function askForSale(cell: ProfileCollectionCell) {
    if (!ask || askingKey) return;
    setAskingKey(cell.key);
    try {
      const res = await apiFetch<{ conversationId: string; sent: boolean }>(
        "/api/chat/ask-item",
        { method: "POST", body: { ownerId: ask.ownerId, itemId: cell.itemId } }
      );
      toast({ title: res.sent ? t("askSent") : t("askAlready"), variant: "success" });
      router.push(`/meddelanden/${res.conversationId}`);
    } catch (e) {
      toast({
        title: t("askFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setAskingKey(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cells.map((c) => {
        const clickable = c.slug != null;
        return (
          <div key={c.key} className="card-surface flex flex-col gap-2 p-3">
            <button
              type="button"
              onClick={() => open(c.slug)}
              disabled={!clickable}
              className="flex flex-col gap-2 text-left disabled:cursor-default"
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
            {ask && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                loading={askingKey === c.key}
                disabled={askingKey != null && askingKey !== c.key}
                onClick={() => void askForSale(c)}
              >
                <IconMail size={14} />
                {t("askForSale")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
