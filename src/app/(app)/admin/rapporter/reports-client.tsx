"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReportStatus } from "@prisma/client";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";

export interface ReportRow {
  id: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  reporterName: string;
  post: {
    id: string;
    title: string;
    isHidden: boolean;
    authorName: string;
  };
}

const STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: "Öppna",
  REVIEWED: "Granskade",
  ACTIONED: "Åtgärdade",
  DISMISSED: "Avfärdade",
};

const STATUS_VARIANTS: Record<ReportStatus, BadgeVariant> = {
  OPEN: "warning",
  REVIEWED: "info",
  ACTIONED: "success",
  DISMISSED: "default",
};

const STATUSES: ReportStatus[] = ["OPEN", "REVIEWED", "ACTIONED", "DISMISSED"];

interface ReportsClientProps {
  reports: ReportRow[];
  activeStatus: ReportStatus;
}

export function ReportsClient({ reports, activeStatus }: ReportsClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(report: ReportRow, status: ReportStatus, hidePost: boolean) {
    setBusy(`${report.id}:${status}`);
    try {
      const res = await fetch(`/api/admin/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hidePost ? { status, hidePost: true } : { status }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte uppdatera rapporten.");
      toast({
        title: hidePost ? "Inlägget har dolts" : "Rapporten avfärdad",
        description: report.post.title,
        variant: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid moderering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Filtrera rapporter på status"
        className="flex gap-1 overflow-x-auto rounded-lg border border-surface-border bg-surface-raised p-1"
      >
        {STATUSES.map((status) => {
          const isActive = status === activeStatus;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => router.push(`/admin/rapporter?status=${status}`)}
              className={cn(
                "whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
                isActive
                  ? "bg-surface-overlay text-holo-cyan shadow-card"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              {STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title={
            activeStatus === "OPEN"
              ? "Inga öppna rapporter"
              : `Inga rapporter med status ${STATUS_LABELS[activeStatus].toLowerCase()}`
          }
          description={
            activeStatus === "OPEN"
              ? "Bra jobbat! Det finns inget att moderera just nu."
              : "Prova en annan statusflik."
          }
        />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/community/${report.post.id}`}
                      className="font-medium text-ink underline-offset-2 hover:text-holo-cyan hover:underline"
                    >
                      {report.post.title}
                    </Link>
                    <Badge variant={STATUS_VARIANTS[report.status]}>
                      {STATUS_LABELS[report.status]}
                    </Badge>
                    {report.post.isHidden && <Badge variant="danger">Dolt inlägg</Badge>}
                  </div>
                  <p className="text-sm text-ink-muted">
                    Av {report.post.authorName} · Rapporterad av {report.reporterName}{" "}
                    {formatRelative(report.createdAt)}
                  </p>
                  <p className="text-sm text-ink">
                    <span className="font-medium text-ink-muted">Anledning:</span>{" "}
                    {report.reason}
                  </p>
                </div>
                {report.status === "OPEN" && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === `${report.id}:ACTIONED`}
                      disabled={busy !== null && busy !== `${report.id}:ACTIONED`}
                      onClick={() => resolve(report, "ACTIONED", true)}
                    >
                      Dölj inlägg
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `${report.id}:DISMISSED`}
                      disabled={busy !== null && busy !== `${report.id}:DISMISSED`}
                      onClick={() => resolve(report, "DISMISSED", false)}
                    >
                      Avfärda
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
