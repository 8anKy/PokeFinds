"use client";

/**
 * Mobilens samlings-rutnät (app-känsla):
 *  - Tryck på ett objekt → öppna produktsidan (inspektera, precis som i Utforska).
 *  - Håll inne (long-press) ELLER tryck "Välj" → väljläge: bocka i flera objekt och
 *    radera dem på en gång. Radering går mot DELETE /api/collection/{id}.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { IconCheck, IconPackage, IconTrash, IconX } from "@/components/ui/icons";
import { openProductOverlay } from "@/lib/product-overlay-open";
import type { CollectionRow } from "./collection-client";

const LONG_PRESS_MS = 450;

export function MobileCollectionGrid({ rows }: { rows: CollectionRow[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const startPress = useCallback(
    (id: string) => {
      longPressed.current = false;
      pressTimer.current = window.setTimeout(() => {
        longPressed.current = true;
        setSelectMode(true);
        setSelected((prev) => new Set(prev).add(id));
      }, LONG_PRESS_MS);
    },
    []
  );

  const cancelPress = useCallback(() => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(
    (row: CollectionRow) => {
      if (longPressed.current) {
        longPressed.current = false;
        return; // long-press hanterades redan (gick in i väljläge)
      }
      if (selectMode) {
        toggle(row.id);
        return;
      }
      if (row.slug) {
        // Öppna overlayn (svep-tillbaka funkar) — på touch. Faller tillbaka på
        // vanlig nav om overlayn inte är tillgänglig (desktop).
        if (!openProductOverlay(row.slug)) router.push(`/produkter/${row.slug}`);
      } else {
        toast({
          title: "Ingen produktsida",
          description: "Det här objektet saknar en kopplad produkt att inspektera.",
          variant: "error",
        });
      }
    },
    [router, selectMode, toggle, toast]
  );

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Radera ${selected.size} objekt ur din samling?`)) return;
    setDeleting(true);
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await apiFetch(`/api/collection/${id}`, { method: "DELETE" });
        ok += 1;
      } catch {
        /* fortsätt med nästa */
      }
    }
    setDeleting(false);
    exitSelect();
    toast({
      title: ok === ids.length ? "Objekt raderade" : "Delvis raderat",
      description:
        ok === ids.length
          ? `${ok} objekt togs bort.`
          : `${ok} av ${ids.length} objekt togs bort.`,
      variant: ok === ids.length ? "success" : "error",
    });
    router.refresh();
  }

  return (
    <section className="lg:hidden">
      {/* Sektionshuvud / väljlägets verktygsrad */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {selectMode ? (
          <>
            <button
              type="button"
              onClick={exitSelect}
              className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
            >
              <IconX size={16} /> Avbryt
            </button>
            <span className="text-sm font-semibold text-ink">{selected.size} valda</span>
            <Button
              variant="danger"
              size="sm"
              onClick={deleteSelected}
              loading={deleting}
              disabled={selected.size === 0}
            >
              <IconTrash size={16} /> Radera
            </Button>
          </>
        ) : (
          <>
            <h2 className="font-display text-xl font-bold text-ink">Din samling</h2>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="text-sm font-semibold text-holo-cyan hover:underline"
            >
              Välj
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {rows.map((r) => {
          const isSelected = selected.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => handleClick(r)}
              onPointerDown={() => startPress(r.id)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              className={`card-surface relative flex flex-col gap-2 p-3 text-left transition-colors ${
                isSelected ? "border-holo-cyan ring-1 ring-holo-cyan" : ""
              }`}
            >
              {/* Markering i väljläget */}
              {selectMode && (
                <span
                  className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-holo-cyan bg-holo-cyan text-black"
                      : "border-surface-border bg-surface/80 text-transparent"
                  }`}
                >
                  <IconCheck size={14} />
                </span>
              )}
              <div className="h-28 w-full overflow-hidden rounded-lg bg-surface-overlay">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
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
                <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                {r.setName && <p className="truncate text-xs text-ink-muted">{r.setName}</p>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {r.estimatedValue != null ? formatPrice(r.estimatedValue) : "–"}
                </span>
                {r.quantity > 1 && <span className="text-xs text-ink-muted">{r.quantity} st</span>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
