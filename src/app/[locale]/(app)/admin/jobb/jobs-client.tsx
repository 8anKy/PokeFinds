"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import type { JobStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export interface JobRow {
  id: string;
  sourceName: string;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  itemsFound: number;
  itemsUpdated: number;
  errorMessage: string | null;
  logs: string[];
}

const STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: "Köad",
  RUNNING: "Pågår",
  COMPLETED: "Slutförd",
  FAILED: "Misslyckad",
  CANCELLED: "Avbruten",
};

const STATUS_VARIANTS: Record<JobStatus, BadgeVariant> = {
  QUEUED: "default",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
};

function duration(job: JobRow): string {
  if (!job.startedAt) return "–";
  const start = new Date(job.startedAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}

export function JobsClient({ jobs }: { jobs: JobRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<JobRow | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);

  async function triggerScrape() {
    setScraping(true);
    setScrapeResult(null);
    try {
      const res = await fetch("/api/admin/scrape", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScrapeResult(`Fel: ${data.error ?? res.statusText}`);
      } else {
        const sources = data.sources ?? data.scrapes?.length ?? 0;
        const updated = (data.scrapes ?? []).reduce(
          (sum: number, s: { itemsUpdated?: number }) => sum + (s.itemsUpdated ?? 0),
          0
        );
        setScrapeResult(`Klart! ${sources} källor, ${updated} priser uppdaterade.`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setScrapeResult(`Nätverksfel: ${err instanceof Error ? err.message : "okänt"}`);
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink-muted">Visar de {jobs.length} senaste jobben.</p>
          {scrapeResult && (
            <p className="text-sm text-rise">{scrapeResult}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            loading={scraping}
            onClick={triggerScrape}
          >
            Kör insamling nu
          </Button>
          <Button
            variant="secondary"
            loading={isPending}
            onClick={() => startTransition(() => router.refresh())}
          >
            Uppdatera
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="Inga scrapingjobb ännu"
          description="Kör en datakälla från fliken Datakällor för att skapa ett jobb."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Källa</TH>
              <TH>Status</TH>
              <TH>Startade</TH>
              <TH>Körtid</TH>
              <TH>Hittade</TH>
              <TH>Uppdaterade</TH>
              <TH>Fel</TH>
              <TH>Loggar</TH>
            </TR>
          </THead>
          <TBody>
            {jobs.map((job) => (
              <TR key={job.id}>
                <TD className="font-medium">{job.sourceName}</TD>
                <TD>
                  <Badge variant={STATUS_VARIANTS[job.status]}>
                    {STATUS_LABELS[job.status]}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">
                  {formatDateTime(job.startedAt ?? job.createdAt)}
                </TD>
                <TD className="whitespace-nowrap">{duration(job)}</TD>
                <TD>{job.itemsFound}</TD>
                <TD>{job.itemsUpdated}</TD>
                <TD
                  className="max-w-[200px] truncate text-fall"
                  title={job.errorMessage ?? undefined}
                >
                  {job.errorMessage ?? "–"}
                </TD>
                <TD>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(job)}>
                    Visa
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `Jobb – ${selected.sourceName}` : "Jobb"}
        className="max-w-2xl"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <Badge variant={STATUS_VARIANTS[selected.status]}>
                {STATUS_LABELS[selected.status]}
              </Badge>
              <span>Startade: {formatDateTime(selected.startedAt ?? selected.createdAt)}</span>
              <span>Körtid: {duration(selected)}</span>
            </div>
            {selected.errorMessage && (
              <div className="rounded-lg border border-fall/30 bg-fall/10 p-3 text-sm text-fall">
                <p className="font-semibold">Felmeddelande</p>
                <p className="mt-1 break-words">{selected.errorMessage}</p>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">
                Loggar ({selected.logs.length})
              </p>
              {selected.logs.length === 0 ? (
                <p className="text-sm text-ink-faint">Inga loggrader.</p>
              ) : (
                <ol className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-surface-border bg-surface-raised p-3 font-mono text-xs text-ink-muted">
                  {selected.logs.map((line, i) => (
                    <li key={i} className="break-words">
                      {line}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
