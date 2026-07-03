"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import type { SourceType } from "@prisma/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";

export interface RetailerRow {
  id: string;
  name: string;
  websiteUrl: string;
  country: string;
  isActive: boolean;
  sourceType: SourceType;
  affiliateEnabled: boolean;
  affiliateParams: string | null;
  offerCount: number;
}

const TYPE_VARIANTS: Record<SourceType, BadgeVariant> = {
  API: "info",
  FEED: "success",
  SCRAPER: "warning",
  MANUAL: "default",
  MOCK: "holo",
};

const ALL_TYPES: SourceType[] = ["API", "FEED", "SCRAPER", "MANUAL", "MOCK"];

interface EditState {
  websiteUrl: string;
  isActive: boolean;
  affiliateEnabled: boolean;
  affiliateParams: string;
}

interface CreateState {
  name: string;
  websiteUrl: string;
  country: string;
  sourceType: SourceType;
  affiliateEnabled: boolean;
  affiliateParams: string;
}

const EMPTY_CREATE: CreateState = {
  name: "",
  websiteUrl: "",
  country: "SE",
  sourceType: "MANUAL",
  affiliateEnabled: false,
  affiliateParams: "",
};

export function RetailersClient({ retailers }: { retailers: RetailerRow[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [editing, setEditing] = useState<RetailerRow | null>(null);
  const [editForm, setEditForm] = useState<EditState>({
    websiteUrl: "",
    isActive: true,
    affiliateEnabled: false,
    affiliateParams: "",
  });
  const [addOpen, setAddOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateState>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);

  function openEdit(retailer: RetailerRow) {
    setEditing(retailer);
    setEditForm({
      websiteUrl: retailer.websiteUrl,
      isActive: retailer.isActive,
      affiliateEnabled: retailer.affiliateEnabled,
      affiliateParams: retailer.affiliateParams ?? "",
    });
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/retailers/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: editForm.websiteUrl,
          isActive: editForm.isActive,
          affiliateEnabled: editForm.affiliateEnabled,
          affiliateParams: editForm.affiliateParams.trim() || null,
        }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte uppdatera butiken.");
      toast({ title: "Butik uppdaterad", description: editing.name, variant: "success" });
      setEditing(null);
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid uppdatering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/retailers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          websiteUrl: createForm.websiteUrl,
          country: createForm.country,
          sourceType: createForm.sourceType,
          affiliateEnabled: createForm.affiliateEnabled,
          ...(createForm.affiliateParams.trim()
            ? { affiliateParams: createForm.affiliateParams.trim() }
            : {}),
        }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte skapa butiken.");
      toast({ title: "Butik skapad", description: createForm.name, variant: "success" });
      setAddOpen(false);
      setCreateForm(EMPTY_CREATE);
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid skapande",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {retailers.length === 1 ? "1 butik" : `${retailers.length} butiker`}
        </p>
        <Button onClick={() => setAddOpen(true)}>Lägg till butik</Button>
      </div>

      {retailers.length === 0 ? (
        <EmptyState
          title="Inga butiker"
          description="Lägg till en butik för att kunna koppla erbjudanden till den."
          action={<Button onClick={() => setAddOpen(true)}>Lägg till butik</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Namn</TH>
              <TH>Land</TH>
              <TH>Status</TH>
              <TH>Affiliate</TH>
              <TH>Källtyp</TH>
              <TH>Erbjudanden</TH>
              <TH>Åtgärder</TH>
            </TR>
          </THead>
          <TBody>
            {retailers.map((retailer) => (
              <TR key={retailer.id}>
                <TD>
                  <div className="font-medium">{retailer.name}</div>
                  <a
                    href={retailer.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-ink-faint underline-offset-2 hover:text-holo-cyan hover:underline"
                  >
                    {retailer.websiteUrl}
                  </a>
                </TD>
                <TD>{retailer.country}</TD>
                <TD>
                  {retailer.isActive ? (
                    <Badge variant="success">Aktiv</Badge>
                  ) : (
                    <Badge>Inaktiv</Badge>
                  )}
                </TD>
                <TD>
                  {retailer.affiliateEnabled ? (
                    <Badge variant="holo">Affiliate</Badge>
                  ) : (
                    <span className="text-ink-faint">–</span>
                  )}
                </TD>
                <TD>
                  <Badge variant={TYPE_VARIANTS[retailer.sourceType]}>
                    {retailer.sourceType}
                  </Badge>
                </TD>
                <TD>{retailer.offerCount}</TD>
                <TD>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(retailer)}>
                    Redigera
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Redigera butik */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Redigera ${editing.name}` : "Redigera butik"}
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-url">Webbplats</Label>
            <Input
              id="edit-url"
              type="url"
              required
              value={editForm.websiteUrl}
              onChange={(e) => setEditForm((f) => ({ ...f, websiteUrl: e.target.value }))}
            />
          </div>
          <Checkbox
            id="edit-active"
            label="Aktiv"
            checked={editForm.isActive}
            onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          <Checkbox
            id="edit-affiliate"
            label="Affiliate aktiverad"
            checked={editForm.affiliateEnabled}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, affiliateEnabled: e.target.checked }))
            }
          />
          <div>
            <Label htmlFor="edit-affiliate-params">Affiliate-parametrar</Label>
            <Input
              id="edit-affiliate-params"
              maxLength={500}
              value={editForm.affiliateParams}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, affiliateParams: e.target.value }))
              }
              placeholder="t.ex. utm_source=foilio&ref=pf"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Avbryt
            </Button>
            <Button type="submit" loading={saving}>
              Spara
            </Button>
          </div>
        </form>
      </Modal>

      {/* Lägg till butik */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Lägg till butik">
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <Label htmlFor="create-name">Namn</Label>
            <Input
              id="create-name"
              required
              minLength={2}
              maxLength={100}
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="t.ex. Kortlådan"
            />
          </div>
          <div>
            <Label htmlFor="create-url">Webbplats</Label>
            <Input
              id="create-url"
              type="url"
              required
              value={createForm.websiteUrl}
              onChange={(e) => setCreateForm((f) => ({ ...f, websiteUrl: e.target.value }))}
              placeholder="https://exempel.se"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="create-country">Land (ISO-kod)</Label>
              <Input
                id="create-country"
                required
                minLength={2}
                maxLength={2}
                value={createForm.country}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))
                }
                placeholder="SE"
              />
            </div>
            <div>
              <Label htmlFor="create-type">Källtyp</Label>
              <Select
                id="create-type"
                value={createForm.sourceType}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, sourceType: e.target.value as SourceType }))
                }
              >
                {ALL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Checkbox
            id="create-affiliate"
            label="Affiliate aktiverad"
            checked={createForm.affiliateEnabled}
            onChange={(e) =>
              setCreateForm((f) => ({ ...f, affiliateEnabled: e.target.checked }))
            }
          />
          <div>
            <Label htmlFor="create-affiliate-params">Affiliate-parametrar (valfritt)</Label>
            <Input
              id="create-affiliate-params"
              maxLength={500}
              value={createForm.affiliateParams}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, affiliateParams: e.target.value }))
              }
              placeholder="t.ex. utm_source=foilio&ref=pf"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" loading={saving}>
              Skapa butik
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
