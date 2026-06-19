"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice, formatPercent, formatDate } from "@/lib/format";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button, LinkButton } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea, Select, Label, Checkbox, FieldError } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { IconPackage, IconPlus, IconTrendingDown, IconTrendingUp } from "@/components/ui/icons";

export const CONDITION_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Sealed",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  SV: "Svenska",
  EN: "Engelska",
  JP: "Japanska",
  DE: "Tyska",
  FR: "Franska",
  OTHER: "Övrigt",
};

export interface CollectionRow {
  id: string;
  name: string;
  slug: string | null; // produktsida att inspektera (singel → kortets billigaste produkt)
  imageUrl: string | null;
  setName: string | null;
  quantity: number;
  condition: string;
  language: string;
  purchasePrice: number | null; // öre
  purchaseDate: string | null; // ISO
  estimatedValue: number | null; // öre
  gradingCompany: string | null;
  grade: string | null;
  notes: string | null;
}

interface CardHit {
  id: string;
  name: string;
  number: string;
  set: { id: string; name: string } | null;
}

function krToOre(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const kr = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(kr) || kr < 0) return undefined;
  return Math.round(kr * 100);
}

function oreToKr(ore: number | null): string {
  return ore == null ? "" : String(ore / 100).replace(".", ",");
}

function profitPercent(item: CollectionRow): number | null {
  if (item.purchasePrice == null || item.purchasePrice === 0 || item.estimatedValue == null) {
    return null;
  }
  return ((item.estimatedValue - item.purchasePrice) / item.purchasePrice) * 100;
}

/** Enkel CSV-parser med stöd för citattecken. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      const value = (cells[i] ?? "").trim();
      if (value !== "") obj[h] = value;
    });
    return obj;
  });
}

interface FormState {
  cardId: string;
  cardLabel: string;
  freeText: string;
  quantity: string;
  condition: string;
  language: string;
  purchasePrice: string; // kr
  purchaseDate: string;
  estimatedValue: string; // kr
  gradingCompany: string;
  grade: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  cardId: "",
  cardLabel: "",
  freeText: "",
  quantity: "1",
  condition: "NEAR_MINT",
  language: "EN",
  purchasePrice: "",
  purchaseDate: "",
  estimatedValue: "",
  gradingCompany: "",
  grade: "",
  notes: "",
};

export function CollectionClient({
  initialItems,
  isPublicCollection,
}: {
  initialItems: CollectionRow[];
  isPublicCollection: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CollectionRow | null>(null);
  const [deleting, setDeleting] = useState<CollectionRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isPublic, setIsPublic] = useState(isPublicCollection);

  // Kortsökning
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CardHit[]>([]);
  const [searching, setSearching] = useState(false);

  // CSV-import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);

  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch<{ items: CardHit[] }>(
          `/api/cards?query=${encodeURIComponent(q)}&pageSize=8`
        );
        setHits(data.items);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildPayload(f: FormState): Record<string, unknown> | { error: string } {
    const quantity = Number(f.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: "Antal måste vara minst 1." };
    }
    if (!f.cardId && !f.freeText.trim()) {
      return { error: "Välj ett kort eller skriv in ett namn." };
    }
    const notes = f.cardId
      ? f.notes.trim() || undefined
      : [f.freeText.trim(), f.notes.trim()].filter(Boolean).join(" — ");
    return {
      ...(f.cardId ? { cardId: f.cardId } : {}),
      quantity,
      condition: f.condition,
      language: f.language,
      purchasePrice: krToOre(f.purchasePrice),
      estimatedValue: krToOre(f.estimatedValue),
      ...(f.purchaseDate ? { purchaseDate: f.purchaseDate } : {}),
      gradingCompany: f.gradingCompany.trim() || undefined,
      grade: f.grade.trim() || undefined,
      ...(notes ? { notes } : {}),
    };
  }

  async function submitAdd() {
    const payload = buildPayload(form);
    if ("error" in payload && typeof payload.error === "string") {
      setFormError(payload.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch("/api/collection", { method: "POST", body: payload });
      toast({ title: "Tillagd i samlingen", variant: "success" });
      setAddOpen(false);
      setForm(EMPTY_FORM);
      setSearch("");
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(item: CollectionRow) {
    setEditing(item);
    setForm({
      ...EMPTY_FORM,
      quantity: String(item.quantity),
      condition: item.condition,
      language: item.language,
      purchasePrice: oreToKr(item.purchasePrice),
      estimatedValue: oreToKr(item.estimatedValue),
      purchaseDate: item.purchaseDate ? item.purchaseDate.slice(0, 10) : "",
      gradingCompany: item.gradingCompany ?? "",
      grade: item.grade ?? "",
      notes: item.notes ?? "",
    });
    setFormError(null);
  }

  async function submitEdit() {
    if (!editing) return;
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setFormError("Antal måste vara minst 1.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch(`/api/collection/${editing.id}`, {
        method: "PATCH",
        body: {
          quantity,
          condition: form.condition,
          language: form.language,
          purchasePrice: krToOre(form.purchasePrice),
          estimatedValue: krToOre(form.estimatedValue),
          ...(form.purchaseDate ? { purchaseDate: form.purchaseDate } : {}),
          ...(form.gradingCompany.trim() ? { gradingCompany: form.gradingCompany.trim() } : {}),
          ...(form.grade.trim() ? { grade: form.grade.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        },
      });
      toast({ title: "Objektet har uppdaterats", variant: "success" });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await apiFetch(`/api/collection/${deleting.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== deleting.id));
      toast({ title: "Objektet har tagits bort", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({
        title: "Det gick inte att ta bort objektet",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
      setDeleting(null);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportErrors([]);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({
          title: "Tom CSV-fil",
          description: "Filen innehöll inga rader att importera.",
          variant: "error",
        });
        return;
      }
      const result = await apiFetch<{ imported: number; errors: { row: number; message: string }[] }>(
        "/api/collection/import",
        { method: "POST", body: { rows } }
      );
      setImportErrors(result.errors);
      toast({
        title: `${result.imported} objekt importerade`,
        description:
          result.errors.length > 0 ? `${result.errors.length} rader kunde inte importeras.` : undefined,
        variant: result.errors.length > 0 ? "default" : "success",
      });
      router.refresh();
    } catch (e) {
      toast({
        title: "Importen misslyckades",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function togglePublic(next: boolean) {
    setIsPublic(next);
    try {
      await apiFetch("/api/users/me", { method: "PATCH", body: { isPublicCollection: next } });
      toast({
        title: next ? "Din samling är nu offentlig" : "Din samling är nu privat",
        variant: "success",
      });
    } catch (e) {
      setIsPublic(!next);
      toast({
        title: "Det gick inte att ändra synligheten",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  const sharedFields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="quantity">Antal</Label>
        <Input
          id="quantity"
          type="number"
          min={1}
          value={form.quantity}
          onChange={(e) => setField("quantity", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="condition">Skick</Label>
        <Select
          id="condition"
          value={form.condition}
          onChange={(e) => setField("condition", e.target.value)}
        >
          {Object.entries(CONDITION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="language">Språk</Label>
        <Select
          id="language"
          value={form.language}
          onChange={(e) => setField("language", e.target.value)}
        >
          {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="purchaseDate">Inköpsdatum</Label>
        <Input
          id="purchaseDate"
          type="date"
          value={form.purchaseDate}
          onChange={(e) => setField("purchaseDate", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="purchasePrice">Inköpspris (kr)</Label>
        <Input
          id="purchasePrice"
          inputMode="decimal"
          placeholder="t.ex. 249,50"
          value={form.purchasePrice}
          onChange={(e) => setField("purchasePrice", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="estimatedValue">Uppskattat värde (kr)</Label>
        <Input
          id="estimatedValue"
          inputMode="decimal"
          placeholder="t.ex. 399"
          value={form.estimatedValue}
          onChange={(e) => setField("estimatedValue", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="gradingCompany">Gradingbolag</Label>
        <Input
          id="gradingCompany"
          placeholder="t.ex. PSA"
          value={form.gradingCompany}
          onChange={(e) => setField("gradingCompany", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="grade">Grad</Label>
        <Input
          id="grade"
          placeholder="t.ex. 10"
          value={form.grade}
          onChange={(e) => setField("grade", e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Anteckningar</Label>
        <Textarea
          id="notes"
          placeholder="Valfria anteckningar…"
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Verktygsrad */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setSearch("");
            setAddOpen(true);
          }}
        >
          <IconPlus size={16} />
          Lägg till manuellt
        </Button>
        <LinkButton href="/api/collection/export" variant="secondary">
          Exportera CSV
        </LinkButton>
        <Button
          variant="secondary"
          loading={importing}
          onClick={() => fileRef.current?.click()}
        >
          Importera CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Välj CSV-fil att importera"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
          }}
        />
        <div className="ml-auto">
          <Checkbox
            id="publicCollection"
            label="Offentlig samling"
            checked={isPublic}
            onChange={(e) => void togglePublic(e.target.checked)}
          />
        </div>
      </div>

      {importErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-fall/30 bg-fall/5 px-4 py-3 text-sm text-ink"
        >
          <p className="font-semibold text-fall">Rader som inte kunde importeras:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-ink-muted">
            {importErrors.slice(0, 10).map((err) => (
              <li key={err.row}>
                Rad {err.row}: {err.message}
              </li>
            ))}
            {importErrors.length > 10 && <li>… och {importErrors.length - 10} till.</li>}
          </ul>
        </div>
      )}

      {/* Tabell */}
      {items.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={32} />}
          title="Din samling är tom"
          description="Lägg till dina kort och sealed-produkter manuellt eller importera en CSV-fil — så håller vi koll på värdet åt dig."
          action={<Button onClick={() => setAddOpen(true)}>Lägg till första objektet</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Namn</TH>
              <TH>Set</TH>
              <TH>Antal</TH>
              <TH>Skick</TH>
              <TH>Språk</TH>
              <TH>Inköpspris</TH>
              <TH>Värde nu</TH>
              <TH>Vinst</TH>
              <TH>Grading</TH>
              <TH className="text-right">Åtgärder</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((item) => {
              const profit = profitPercent(item);
              return (
                <TR key={item.id}>
                  <TD className="font-medium">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="h-12 w-9 shrink-0 rounded object-contain bg-surface-overlay"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-surface-overlay text-ink-faint">
                          <IconPackage size={16} aria-hidden="true" />
                        </span>
                      )}
                      <span>{item.name}</span>
                    </div>
                  </TD>
                  <TD className="text-ink-muted">{item.setName ?? "–"}</TD>
                  <TD className="tabular-nums">{item.quantity}</TD>
                  <TD>{CONDITION_LABELS[item.condition] ?? item.condition}</TD>
                  <TD>{LANGUAGE_LABELS[item.language] ?? item.language}</TD>
                  <TD data-price>{formatPrice(item.purchasePrice)}</TD>
                  <TD data-price className="font-semibold">
                    {formatPrice(item.estimatedValue)}
                  </TD>
                  <TD>
                    {profit != null ? (
                      <span
                        className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
                          profit > 0 ? "text-rise" : profit < 0 ? "text-fall" : "text-ink-muted"
                        }`}
                      >
                        {profit > 0 && <IconTrendingUp size={14} aria-hidden="true" />}
                        {profit < 0 && <IconTrendingDown size={14} aria-hidden="true" />}
                        {formatPercent(profit)}
                      </span>
                    ) : (
                      "–"
                    )}
                  </TD>
                  <TD>
                    {item.gradingCompany && item.grade ? (
                      <Badge variant="holo">
                        {item.gradingCompany} {item.grade}
                      </Badge>
                    ) : (
                      "–"
                    )}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
                        Redigera
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(item)}>
                        Ta bort
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {/* Lägg till */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Lägg till i samlingen"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={() => void submitAdd()} loading={saving}>
              Lägg till
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cardSearch">Sök kort</Label>
            <div className="relative">
              <Input
                id="cardSearch"
                placeholder="t.ex. Charizard ex"
                value={form.cardId ? form.cardLabel : search}
                onChange={(e) => {
                  setField("cardId", "");
                  setField("cardLabel", "");
                  setSearch(e.target.value);
                }}
              />
              {searching && (
                <span className="absolute right-3 top-2.5">
                  <Spinner size="sm" />
                </span>
              )}
            </div>
            {!form.cardId && hits.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-surface-border bg-surface-overlay">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-raised"
                      onClick={() => {
                        const label = `${hit.name} · ${hit.set?.name ?? "Okänt set"} #${hit.number}`;
                        setForm((prev) => ({ ...prev, cardId: hit.id, cardLabel: label, freeText: "" }));
                        setHits([]);
                      }}
                    >
                      {hit.name}{" "}
                      <span className="text-ink-muted">
                        · {hit.set?.name ?? "Okänt set"} #{hit.number}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!form.cardId && (
            <div>
              <Label htmlFor="freeText">…eller fritext (produkt/kort som inte hittas)</Label>
              <Input
                id="freeText"
                placeholder="t.ex. Obsidian Flames Booster Box"
                value={form.freeText}
                onChange={(e) => setField("freeText", e.target.value)}
              />
            </div>
          )}

          {sharedFields}
          <FieldError message={formError} />
        </div>
      </Modal>

      {/* Redigera */}
      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={`Redigera: ${editing?.name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Avbryt
            </Button>
            <Button onClick={() => void submitEdit()} loading={saving}>
              Spara
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {sharedFields}
          <FieldError message={formError} />
        </div>
      </Modal>

      {/* Ta bort */}
      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title="Ta bort objekt?"
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
          Är du säker på att du vill ta bort{" "}
          <span className="font-medium text-ink">{deleting?.name}</span> från din samling? Detta går
          inte att ångra.
        </p>
      </Modal>
    </div>
  );
}
