"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/format";

const df = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

export interface StoreOption {
  id: string;
  name: string;
  /** Värden URL:en måste ligga på — visas som hjälptext, och API:t kräver den. */
  host: string;
}

export interface WatchedRow {
  id: string;
  store: string;
  url: string;
  note: string | null;
  isActive: boolean;
  lastCheckedAt: string | null;
  lastStatus: string;
  lastPriceOre: number | null;
  lastTitle: string | null;
  lastError: string | null;
}

const STATUS_LABEL: Record<string, { text: string; variant: "success" | "danger" | "warning" | "default" }> = {
  IN_STOCK: { text: "I lager", variant: "success" },
  OUT_OF_STOCK: { text: "Slut", variant: "danger" },
  PREORDER: { text: "Förhandsbokning", variant: "warning" },
  UNKNOWN: { text: "Okänd", variant: "default" },
};

export function WatchedListingsClient({ rows, stores }: { rows: WatchedRow[]; stores: StoreOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [retailerId, setRetailerId] = useState(stores[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = stores.find((s) => s.id === retailerId);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/watched-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailerId, url: url.trim(), note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Något gick fel.");
      toast({
        title: data.reactivated ? "Bevakningen slogs på igen" : "Länken bevakas nu",
        description: "Den frågas vid nästa svep — inom minuter i Discord-lanen, i natt i katalogen.",
        variant: "success",
      });
      setUrl("");
      setNote("");
      router.refresh();
    } catch (err) {
      toast({
        title: "Kunde inte lägga till",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function patch(row: WatchedRow, body: Record<string, unknown>, okTitle: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/watched-listings/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Något gick fel.");
      toast({ title: okTitle, variant: "success" });
      router.refresh();
    } catch (err) {
      toast({
        title: "Kunde inte uppdatera",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: WatchedRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/watched-listings/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Något gick fel.");
      toast({ title: "Bevakningen raderad", variant: "success" });
      router.refresh();
    } catch (err) {
      toast({
        title: "Kunde inte radera",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  const active = rows.filter((r) => r.isActive).length;
  const mute = rows.filter((r) => r.isActive && r.lastError).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">Bevakade länkar</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Butikssidor som <strong className="text-ink">inte syns i butikens feed</strong>. Vi frågar
          dem direkt i stället, och svaret behandlas precis som en feed-post: lagerdiff,
          Discord-larm, auto-import till katalogen.
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Använd det här när du VET att en produkt finns hos butiken men den aldrig dyker upp hos
          oss. Vanliga produkter behöver ingen bevakning — feeden hittar dem själv.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="wl-store">Butik</Label>
              <Select
                id="wl-store"
                value={retailerId}
                onChange={(e) => setRetailerId(e.target.value)}
                required
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="wl-url">Produktsidans URL</Label>
              <Input
                id="wl-url"
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={selected ? `https://${selected.host}/products/…` : "https://…"}
              />
              <p className="mt-1 text-xs text-ink-faint">
                Måste ligga på {selected?.host ?? "butikens domän"}. Har sidan flera varianter,
                klistra in länken med <code>?variant=…</code> — den pekar ut rätt SKU.
              </p>
            </div>
            <div>
              <Label htmlFor="wl-note">Anteckning</Label>
              <Input
                id="wl-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Saknas i deras Pokémon-kollektion"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={saving || !retailerId}>
                {saving ? "Lägger till…" : "Bevaka länken"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {mute > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {mute} aktiv{mute === 1 ? " bevakning" : "a bevakningar"} fick inget svar vid senaste
          uppslaget. En bevakning som aldrig svarar är värre än ingen — den ser ut att göra jobbet.
          Kontrollera att URL:en fortfarande finns.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Inga bevakade länkar"
          description="Lägg till en URL ovan när du hittat en produkt hos en butik som aldrig dyker upp hos oss."
        />
      ) : (
        <Card>
          <CardContent className="pt-5">
            <p className="mb-3 text-sm text-ink-muted">
              {active} aktiv{active === 1 ? "" : "a"} av {rows.length}.
            </p>
            <Table>
              <THead>
                <TR>
                  <TH>Butik</TH>
                  <TH>Länk</TH>
                  <TH>Senaste svar</TH>
                  <TH>Kontrollerad</TH>
                  <TH>Åtgärd</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const status = STATUS_LABEL[r.lastStatus] ?? STATUS_LABEL.UNKNOWN;
                  return (
                    <TR key={r.id} className={r.isActive ? undefined : "opacity-50"}>
                      <TD className="whitespace-nowrap font-medium text-ink">{r.store}</TD>
                      <TD className="max-w-[26rem]">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-holo-cyan hover:underline"
                          title={r.url}
                        >
                          {r.lastTitle ?? r.url}
                        </a>
                        {r.note && <p className="mt-0.5 truncate text-xs text-ink-faint">{r.note}</p>}
                        {r.lastError && (
                          <p className="mt-0.5 text-xs text-amber-300">Svarade inte: {r.lastError}</p>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">
                        <Badge variant={status.variant}>{status.text}</Badge>
                        {r.lastPriceOre != null && (
                          <span className="ml-2 text-sm text-ink-muted">
                            {formatPrice(r.lastPriceOre, "SEK")}
                          </span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-sm text-ink-muted">
                        {r.lastCheckedAt ? df.format(new Date(r.lastCheckedAt)) : "aldrig"}
                      </TD>
                      <TD className="whitespace-nowrap">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() =>
                              patch(
                                r,
                                { isActive: !r.isActive },
                                r.isActive ? "Bevakningen pausad" : "Bevakningen påslagen"
                              )
                            }
                          >
                            {r.isActive ? "Pausa" : "Slå på"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === r.id}
                            onClick={() => remove(r)}
                          >
                            Radera
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
