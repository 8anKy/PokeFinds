"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SourceType } from "@prisma/client";
import { formatRelative } from "@/lib/format";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";

export interface SourceRow {
  id: string;
  name: string;
  baseUrl: string;
  type: SourceType;
  isActive: boolean;
  lastRunAt: string | null;
  jobCount: number;
}

const TYPE_VARIANTS: Record<SourceType, BadgeVariant> = {
  API: "info",
  FEED: "success",
  SCRAPER: "warning",
  MANUAL: "default",
  MOCK: "holo",
};

const ALL_TYPES: SourceType[] = ["API", "FEED", "SCRAPER", "MANUAL", "MOCK"];

interface RunSummary {
  jobId: string;
  status: string;
  itemsFound: number;
  itemsUpdated: number;
  errorCount: number;
}

export function SourcesClient({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", baseUrl: "", type: "MOCK" as SourceType });

  async function toggleActive(source: SourceRow) {
    setBusyId(source.id);
    try {
      const res = await fetch(`/api/admin/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !source.isActive }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte uppdatera källan.");
      toast({
        title: !source.isActive ? "Källa aktiverad" : "Källa inaktiverad",
        description: source.name,
        variant: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid uppdatering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function runNow(source: SourceRow) {
    setRunningId(source.id);
    try {
      const res = await fetch("/api/admin/scrape-jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id }),
      });
      const data: (RunSummary & { error?: string }) | { error: string } = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error(("error" in data && data.error) || "Jobbet kunde inte startas.");
      }
      const summary = data as RunSummary;
      toast({
        title: summary.status === "COMPLETED" ? "Jobbet slutfört" : `Jobbet: ${summary.status}`,
        description: `${source.name}: ${summary.itemsFound} hittade, ${summary.itemsUpdated} uppdaterade${summary.errorCount > 0 ? `, ${summary.errorCount} fel` : ""}.`,
        variant: summary.status === "COMPLETED" ? "success" : "error",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid körning",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setRunningId(null);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/admin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte skapa källan.");
      toast({ title: "Källa skapad", description: form.name, variant: "success" });
      setAddOpen(false);
      setForm({ name: "", baseUrl: "", type: "MOCK" });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid skapande",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {sources.length === 1 ? "1 datakälla" : `${sources.length} datakällor`}
        </p>
        <Button onClick={() => setAddOpen(true)}>Lägg till källa</Button>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          title="Inga datakällor"
          description="Lägg till en källa för att börja samla in prisdata."
          action={<Button onClick={() => setAddOpen(true)}>Lägg till källa</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Namn</TH>
              <TH>Typ</TH>
              <TH>Bas-URL</TH>
              <TH>Status</TH>
              <TH>Senaste körning</TH>
              <TH>Jobb</TH>
              <TH>Åtgärder</TH>
            </TR>
          </THead>
          <TBody>
            {sources.map((source) => (
              <TR key={source.id}>
                <TD className="font-medium">{source.name}</TD>
                <TD>
                  <Badge variant={TYPE_VARIANTS[source.type]}>{source.type}</Badge>
                </TD>
                <TD className="max-w-[240px] truncate text-ink-muted" title={source.baseUrl}>
                  {source.baseUrl}
                </TD>
                <TD>
                  {source.isActive ? (
                    <Badge variant="success">Aktiv</Badge>
                  ) : (
                    <Badge>Inaktiv</Badge>
                  )}
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">
                  {source.lastRunAt ? formatRelative(source.lastRunAt) : "Aldrig"}
                </TD>
                <TD>{source.jobCount}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyId === source.id}
                      onClick={() => toggleActive(source)}
                    >
                      {source.isActive ? "Inaktivera" : "Aktivera"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={runningId === source.id}
                      onClick={() => runNow(source)}
                    >
                      Kör nu
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <p className="text-xs text-ink-faint">
        Obs! Nya källor kräver en adapter i <code>src/scrapers/adapters/</code> för att kunna
        köras. Källor av typen MOCK använder den inbyggda mock-adaptern.
      </p>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Lägg till källa">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="source-name">Namn</Label>
            <Input
              id="source-name"
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="t.ex. Kortbutiken"
            />
          </div>
          <div>
            <Label htmlFor="source-url">Bas-URL</Label>
            <Input
              id="source-url"
              type="url"
              required
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://exempel.se"
            />
          </div>
          <div>
            <Label htmlFor="source-type">Typ</Label>
            <Select
              id="source-type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as SourceType }))}
            >
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-ink-faint">
            Nya källor kräver en adapter i <code>src/scrapers/adapters/</code>.
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" loading={creating}>
              Skapa källa
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
