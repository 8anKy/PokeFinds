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
import { cn } from "@/lib/utils";

export interface RetailerRow {
  id: string;
  name: string;
  websiteUrl: string;
  country: string;
  isActive: boolean;
  sourceType: SourceType;
  affiliateEnabled: boolean;
  affiliateParams: string | null;
  /** ISO-sträng eller null. Sponsrad placering t.o.m. — se lib/sponsored-offer.ts. */
  sponsoredUntil: string | null;
  offerCount: number;
}

/** ISO → "YYYY-MM-DD" för <input type="date">. Tom sträng = ingen sponsring. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * "YYYY-MM-DD" → ISO vid dygnets SLUT i UTC, eller null.
 *
 * ⛔ Datumet är INKLUSIVE: skriver man 2026-10-31 ska annonsen synas HELA den 31:e.
 *    En bar `new Date("2026-10-31")` blir midnatt vid dygnets BÖRJAN och hade släckt
 *    sponsringen ett dygn för tidigt — tyst, och först när kunden hör av sig.
 */
function fromDateInput(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

/** Sponsringen går ut av klockan, inte av en bock — visa bara en aktiv period. */
function isSponsoredNow(iso: string | null): boolean {
  return !!iso && new Date(iso).getTime() > Date.now();
}

/**
 * Datumet UTSKRIVET på svenska, t.ex. "3 november 2026".
 *
 * ⛔ FINNS FÖR ATT `<input type="date">` RENDERAS I WEBBLÄSARENS LOKAL, INTE SIDANS.
 *    På en engelskspråkig webbläsare visas fältet som MM/DD/YYYY. Ägaren skrev
 *    2026-09-08 in det som lästes som "3 november" och fick 11 MARS sparat — ett
 *    datum sex månader bakåt, vilket betyder AVSTÄNGD. Inget felmeddelande, inget
 *    syntes: annonsen bara uteblev. Fältet kan inte tvingas till ett format, så
 *    formuläret skriver i stället ut vad det FAKTISKT tolkade.
 */
function humanDate(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
}

/** Ligger datumet bakåt i tiden? Då är sponsringen i praktiken avstängd. */
function isPastDate(value: string): boolean {
  if (!value) return false;
  return new Date(`${value}T23:59:59.999Z`).getTime() <= Date.now();
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
  sponsoredUntil: string;
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
    sponsoredUntil: "",
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
      sponsoredUntil: toDateInput(retailer.sponsoredUntil),
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
          sponsoredUntil: fromDateInput(editForm.sponsoredUntil),
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
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {retailer.affiliateEnabled && <Badge variant="holo">Affiliate</Badge>}
                    {isSponsoredNow(retailer.sponsoredUntil) && (
                      <Badge variant="warning">
                        Annons t.o.m. {toDateInput(retailer.sponsoredUntil)}
                      </Badge>
                    )}
                    {!retailer.affiliateEnabled && !isSponsoredNow(retailer.sponsoredUntil) && (
                      <span className="text-ink-faint">–</span>
                    )}
                  </span>
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
          <div>
            <Label htmlFor="edit-sponsored-until">Sponsrad placering t.o.m.</Label>
            <Input
              id="edit-sponsored-until"
              type="date"
              value={editForm.sponsoredUntil}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, sponsoredUntil: e.target.value }))
              }
            />
            {/* ⛔ KVITTENSEN ÄR INTE PYNT. Fältet renderas i WEBBLÄSARENS lokal, så
                "03/11/2026" kan vara både 3 november och 11 mars — och ett förflutet
                datum betyder AVSTÄNGD, tyst. Skriv därför alltid ut vad vi tolkade. */}
            {editForm.sponsoredUntil && (
              <p
                className={cn(
                  "mt-1.5 text-xs font-medium",
                  isPastDate(editForm.sponsoredUntil) ? "text-fall" : "text-holo-cyan"
                )}
              >
                {isPastDate(editForm.sponsoredUntil)
                  ? `⚠ ${humanDate(editForm.sponsoredUntil)} har redan passerat — sparar du nu är annonsen AVSTÄNGD.`
                  : `Annonsen visas t.o.m. ${humanDate(editForm.sponsoredUntil)}.`}
              </p>
            )}
            <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
              Butiken får ett eget ark märkt „Annons” ovanför butikslistan på de produkter
              den har i lager. Butikslistan under påverkas inte — så lovar villkor §8 och
              „Så rankar vi” på /om. Töm fältet för att släcka direkt; datumet gäller hela
              dygnet ut och släcks sedan av sig självt.
            </p>
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
