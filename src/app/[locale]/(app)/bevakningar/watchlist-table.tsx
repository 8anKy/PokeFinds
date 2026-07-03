"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Checkbox } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export interface WatchlistRow {
  id: string;
  targetPrice: number | null; // öre
  restockAlert: boolean;
  priceAlert: boolean;
  isPaused: boolean;
  product: {
    id: string;
    title: string;
    slug: string;
    lowestPrice: number | null; // öre
    setName: string | null;
  };
}

function oreToKrInput(ore: number | null): string {
  return ore == null ? "" : String(ore / 100).replace(".", ",");
}

function krInputToOre(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const kr = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(kr) || kr < 0) return null;
  return Math.round(kr * 100);
}

export function WatchlistTable({ initialItems }: { initialItems: WatchlistRow[] }) {
  const [items, setItems] = useState(initialItems);
  const [editing, setEditing] = useState<WatchlistRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleting, setDeleting] = useState<WatchlistRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function patchItem(id: string, body: Record<string, unknown>, successTitle: string) {
    setBusyId(id);
    try {
      const updated = await apiFetch<WatchlistRow & { product: { offers?: unknown } }>(
        `/api/watchlist/${id}`,
        { method: "PATCH", body }
      );
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                targetPrice: updated.targetPrice ?? null,
                restockAlert: updated.restockAlert,
                priceAlert: updated.priceAlert,
                isPaused: updated.isPaused,
              }
            : it
        )
      );
      toast({ title: successTitle, variant: "success" });
    } catch (e) {
      toast({
        title: "Det gick inte att uppdatera bevakningen",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(item: WatchlistRow) {
    setEditing(item);
    setEditValue(oreToKrInput(item.targetPrice));
  }

  async function saveTargetPrice() {
    if (!editing) return;
    const ore = krInputToOre(editValue);
    if (editValue.trim() && ore == null) {
      toast({ title: "Ogiltigt pris", description: "Ange ett pris i kronor.", variant: "error" });
      return;
    }
    setSaving(true);
    await patchItem(editing.id, { targetPrice: ore }, "Målpriset har uppdaterats");
    setSaving(false);
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await apiFetch(`/api/watchlist/${deleting.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== deleting.id));
      toast({ title: "Bevakningen har tagits bort", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({
        title: "Det gick inte att ta bort bevakningen",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
      setDeleting(null);
    }
  }

  const actionButtons = (item: WatchlistRow) => (
    <>
      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
        Redigera
      </Button>
      <Button
        size="sm"
        variant="secondary"
        loading={busyId === item.id}
        onClick={() =>
          void patchItem(
            item.id,
            { isPaused: !item.isPaused },
            item.isPaused ? "Bevakningen är igång igen" : "Bevakningen är pausad"
          )
        }
      >
        {item.isPaused ? "Återuppta" : "Pausa"}
      </Button>
      <Button size="sm" variant="danger" onClick={() => setDeleting(item)}>
        Ta bort
      </Button>
    </>
  );

  return (
    <>
      {/* Mobil: kort-layout — tabellen tvingar horisontell scroll på liten skärm. */}
      <div className="space-y-3 lg:hidden">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "rounded-xl border border-surface-border bg-surface-raised/40 p-4",
              item.isPaused && "opacity-60"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/produkter/${item.product.slug}`}
                  className="font-medium text-ink transition-colors hover:text-holo-cyan"
                >
                  {item.product.title}
                </Link>
                {item.product.setName && (
                  <p className="text-xs text-ink-muted">{item.product.setName}</p>
                )}
              </div>
              {item.isPaused ? (
                <Badge variant="warning">Pausad</Badge>
              ) : (
                <Badge variant="success">Aktiv</Badge>
              )}
            </div>

            <div className="mt-3 flex gap-6 text-sm">
              <div>
                <p className="text-xs text-ink-muted">Lägsta pris nu</p>
                <p data-price className="font-semibold text-ink">
                  {formatPrice(item.product.lowestPrice)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Målpris</p>
                <p data-price className="font-semibold text-ink">
                  {item.targetPrice != null ? formatPrice(item.targetPrice) : "–"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-col items-start gap-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  checked={item.restockAlert}
                  disabled={busyId === item.id}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { restockAlert: e.target.checked },
                      e.target.checked ? "Restock-larm på" : "Restock-larm av"
                    )
                  }
                />
                Restock-larm
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  checked={item.priceAlert}
                  disabled={busyId === item.id}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { priceAlert: e.target.checked },
                      e.target.checked ? "Prislarm på" : "Prislarm av"
                    )
                  }
                />
                Prislarm
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">{actionButtons(item)}</div>
          </div>
        ))}
      </div>

      {/* Desktop: full tabell. */}
      <div className="hidden lg:block">
      <Table>
        <THead>
          <TR>
            <TH>Produkt</TH>
            <TH>Lägsta pris nu</TH>
            <TH>Målpris</TH>
            <TH>Restock</TH>
            <TH>Prislarm</TH>
            <TH>Status</TH>
            <TH className="text-right">Åtgärder</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((item) => (
            <TR key={item.id} className={item.isPaused ? "opacity-60" : undefined}>
              <TD>
                <Link
                  href={`/produkter/${item.product.slug}`}
                  className="font-medium text-ink transition-colors hover:text-holo-cyan"
                >
                  {item.product.title}
                </Link>
                {item.product.setName && (
                  <p className="text-xs text-ink-muted">{item.product.setName}</p>
                )}
              </TD>
              <TD data-price className="font-semibold">
                {formatPrice(item.product.lowestPrice)}
              </TD>
              <TD data-price>{item.targetPrice != null ? formatPrice(item.targetPrice) : "–"}</TD>
              <TD>
                <Checkbox
                  checked={item.restockAlert}
                  disabled={busyId === item.id}
                  aria-label={`Restock-larm för ${item.product.title}`}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { restockAlert: e.target.checked },
                      e.target.checked ? "Restock-larm på" : "Restock-larm av"
                    )
                  }
                />
              </TD>
              <TD>
                <Checkbox
                  checked={item.priceAlert}
                  disabled={busyId === item.id}
                  aria-label={`Prislarm för ${item.product.title}`}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { priceAlert: e.target.checked },
                      e.target.checked ? "Prislarm på" : "Prislarm av"
                    )
                  }
                />
              </TD>
              <TD>
                {item.isPaused ? (
                  <Badge variant="warning">Pausad</Badge>
                ) : (
                  <Badge variant="success">Aktiv</Badge>
                )}
              </TD>
              <TD>
                <div className="flex justify-end gap-2">{actionButtons(item)}</div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      </div>

      {/* Redigera målpris */}
      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title="Redigera målpris"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Avbryt
            </Button>
            <Button onClick={() => void saveTargetPrice()} loading={saving}>
              Spara
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveTargetPrice();
          }}
        >
          <p className="mb-4 text-sm text-ink-muted">
            Vi larmar dig när <span className="font-medium text-ink">{editing?.product.title}</span>{" "}
            kostar lika med eller mindre än ditt målpris. Lämna tomt för att ta bort målpriset.
          </p>
          <Label htmlFor="targetPrice">Målpris (kr)</Label>
          <Input
            id="targetPrice"
            inputMode="decimal"
            placeholder="t.ex. 499"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            autoFocus
          />
        </form>
      </Modal>

      {/* Bekräfta borttagning */}
      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title="Ta bort bevakning?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={saving}>
              Ta bort
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Är du säker på att du vill sluta bevaka{" "}
          <span className="font-medium text-ink">{deleting?.product.title}</span>? Du får inga fler
          larm för den här produkten.
        </p>
      </Modal>
    </>
  );
}
