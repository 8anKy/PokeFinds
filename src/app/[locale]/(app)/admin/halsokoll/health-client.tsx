"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { formatRelative } from "@/lib/format";
import { HEALTH_SECTIONS, type HealthSection } from "@/lib/store-health-findings";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";

export interface FindingRow {
  id: string;
  section: string;
  severity: string;
  title: string;
  detail: string | null;
  url: string | null;
  offerId: string | null;
  productSlug: string | null;
  retailer: string | null;
  reportedAt: string;
}

export interface AckRow {
  id: string;
  section: string;
  title: string;
  createdAt: string;
}

const SEVERITY_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  DEFINITE: { label: "Säkert fel", variant: "danger" },
  REVIEW: { label: "Granska", variant: "warning" },
  INFO: { label: "Info", variant: "default" },
};

/** Sektioner som öppnas direkt — de kräver handling; resten är kännedom/granskning. */
const OPEN_BY_DEFAULT = new Set<string>([
  "STORE_ADAPTER",
  "UNDERPRICE",
  "LINK_DEFINITE",
  "GTIN_CONFLICT",
  "CM_SINGLE_LINK",
]);

const WORKFLOW_URL = "https://github.com/8anKy/PokeFinds/actions/workflows/store-health.yml";

export function HealthClient({ findings, acks }: { findings: FindingRow[]; acks: AckRow[] }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Raderade offers — fyndraden ligger kvar i DB till nästa veckokörning, så vi
  // markerar den som åtgärdad lokalt i stället för att låtsas att den försvann.
  const [done, setDone] = useState<Set<string>>(new Set());
  // Kvitterade i den här sessionen (servern filtrerar redan bort tidigare kvitterade).
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [undone, setUndone] = useState<Set<string>>(new Set());

  async function ackFinding(row: FindingRow) {
    setBusy(`ack:${row.id}`);
    try {
      const res = await fetch("/api/admin/health-acks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: row.id }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte kvittera fyndet.");
      setAcked((prev) => new Set(prev).add(row.id));
      toast({
        title: "Kvitterat som korrekt",
        description: "Fyndet döljs och gör inte längre körningen röd. Ångra under Kvitterade.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Fel vid kvittering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function unack(ack: AckRow) {
    setBusy(`unack:${ack.id}`);
    try {
      const res = await fetch(`/api/admin/health-acks/${ack.id}`, { method: "DELETE" });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte ångra kvitteringen.");
      setUndone((prev) => new Set(prev).add(ack.id));
      toast({
        title: "Kvittering ångrad",
        description: "Fyndet räknas som rött igen från nästa körning (ladda om sidan för att se det).",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Fel vid ångring",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function deleteOffer(row: FindingRow) {
    if (!row.offerId) return;
    setBusy(row.id);
    try {
      const res = await fetch(`/api/admin/offers/${row.offerId}`, { method: "DELETE" });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte ta bort offern.");
      setDone((prev) => new Set(prev).add(row.id));
      toast({ title: "Offern borttagen", description: row.title, variant: "success" });
    } catch (error) {
      toast({
        title: "Fel vid borttagning",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  const bySection = new Map<string, FindingRow[]>();
  for (const f of findings) {
    if (!bySection.has(f.section)) bySection.set(f.section, []);
    bySection.get(f.section)!.push(f);
  }
  const latest = findings.reduce<string | null>(
    (acc, f) => (acc === null || f.reportedAt > acc ? f.reportedAt : acc),
    null
  );

  const sectionKeys = Object.keys(HEALTH_SECTIONS) as HealthSection[];
  // Sektioner som inte finns i HEALTH_SECTIONS (äldre körning efter en omdöpning) visas sist.
  const unknownSections = [...bySection.keys()].filter((s) => !(s in HEALTH_SECTIONS));

  if (findings.length === 0 && acks.length === 0) {
    return (
      <EmptyState
        title="Ingen hälsokolls-backlog inläst"
        description="Fynden skrivs av veckokörningen (måndagar 06:00 UTC). Kör workflowen manuellt via GitHub Actions → Butiks-hälsokoll för att fylla listan direkt."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Backlog ur senaste hälsokollen{latest ? ` (${formatRelative(latest)})` : ""} — samma fynd
        som gör veckokörningen röd.{" "}
        <a
          href={WORKFLOW_URL}
          target="_blank"
          rel="noreferrer"
          className="text-holo-cyan underline-offset-2 hover:underline"
        >
          Öppna körningen på GitHub
        </a>
        . Varje sektion ersätts av nästa körning — det som är åtgärdat försvinner då av sig
        självt.
      </p>

      {[...sectionKeys, ...unknownSections].map((key) => {
        const rows = bySection.get(key) ?? [];
        if (rows.length === 0) return null;
        const meta =
          key in HEALTH_SECTIONS
            ? HEALTH_SECTIONS[key as HealthSection]
            : { label: key, blurb: "", canDeleteOffer: false };

        return (
          <details key={key} open={OPEN_BY_DEFAULT.has(key)} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-4 py-2.5">
              <span className="text-ink-muted transition-transform group-open:rotate-90">▸</span>
              <span className="font-medium text-ink">{meta.label}</span>
              <Badge variant={rows.some((r) => r.severity === "DEFINITE") ? "danger" : rows.some((r) => r.severity === "REVIEW") ? "warning" : "default"}>
                {rows.length}
              </Badge>
            </summary>
            {meta.blurb && <p className="px-4 py-2 text-sm text-ink-muted">{meta.blurb}</p>}
            <div className="mt-1 space-y-2">
              {rows.map((row) => {
                const isDone = done.has(row.id);
                const isAcked = acked.has(row.id);
                // ⛔ Döda länkar rensas av auto-prunen och får ALDRIG denylistas via
                // admin-raderingen (kommer varan tillbaka SKA länken återskapas).
                const deadLink = row.detail?.startsWith("DÖD LÄNK") ?? false;
                const canDelete = meta.canDeleteOffer && !!row.offerId && !deadLink && !isDone && !isAcked;
                const canAck = !isDone && !isAcked;
                return (
                  <Card key={row.id} className={isDone || isAcked ? "opacity-50" : undefined}>
                    <CardContent className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={SEVERITY_BADGE[row.severity]?.variant ?? "default"}>
                            {SEVERITY_BADGE[row.severity]?.label ?? row.severity}
                          </Badge>
                          {row.retailer && (
                            <span className="text-xs text-ink-muted">{row.retailer}</span>
                          )}
                          {isDone && <Badge variant="success">Åtgärdad</Badge>}
                          {isAcked && <Badge variant="success">Kvitterad OK</Badge>}
                          {deadLink && <Badge variant="default">rensas automatiskt</Badge>}
                        </div>
                        {row.productSlug ? (
                          <Link
                            href={`/produkter/${row.productSlug}`}
                            className="block break-words font-medium text-ink underline-offset-2 hover:text-holo-cyan hover:underline"
                          >
                            {row.title}
                          </Link>
                        ) : (
                          <p className="break-words font-medium text-ink">{row.title}</p>
                        )}
                        {row.detail && <p className="break-words text-sm text-ink-muted">{row.detail}</p>}
                        {row.url && (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-xs text-holo-cyan underline-offset-2 hover:underline"
                          >
                            {row.url}
                          </a>
                        )}
                      </div>
                      {(canDelete || canAck) && (
                        <div className="flex shrink-0 items-center gap-2">
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="danger"
                              loading={busy === row.id}
                              disabled={busy !== null && busy !== row.id}
                              onClick={() => deleteOffer(row)}
                            >
                              Ta bort offer
                            </Button>
                          )}
                          {canAck && (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === `ack:${row.id}`}
                              disabled={busy !== null && busy !== `ack:${row.id}`}
                              onClick={() => ackFinding(row)}
                            >
                              Korrekt — kvittera
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </details>
        );
      })}

      {acks.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-4 py-2.5">
            <span className="text-ink-muted transition-transform group-open:rotate-90">▸</span>
            <span className="font-medium text-ink">Kvitterade som korrekta</span>
            <Badge variant="success">{acks.length}</Badge>
          </summary>
          <p className="px-4 py-2 text-sm text-ink-muted">
            Fynd du bedömt som korrekta — dolda ur listan och räknas inte som röda i
            veckokörningen. Ångra så räknas fyndet igen från nästa körning.
          </p>
          <div className="mt-1 space-y-2">
            {acks.map((ack) => {
              const isUndone = undone.has(ack.id);
              const sectionLabel =
                ack.section in HEALTH_SECTIONS
                  ? HEALTH_SECTIONS[ack.section as HealthSection].label
                  : ack.section;
              return (
                <Card key={ack.id} className={isUndone ? "opacity-50" : undefined}>
                  <CardContent className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default">{sectionLabel}</Badge>
                        <span className="text-xs text-ink-muted">
                          kvitterad {formatRelative(ack.createdAt)}
                        </span>
                        {isUndone && <Badge variant="warning">Ångrad</Badge>}
                      </div>
                      <p className="break-words font-medium text-ink">{ack.title}</p>
                    </div>
                    {!isUndone && (
                      <div className="shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy === `unack:${ack.id}`}
                          disabled={busy !== null && busy !== `unack:${ack.id}`}
                          onClick={() => unack(ack)}
                        >
                          Ångra
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
