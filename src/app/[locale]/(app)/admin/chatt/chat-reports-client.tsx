"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { ChatReportRow } from "@/services/chat";
import { localeTag } from "@/components/chat/conversation-list";

export type AdminReportStatus = "OPEN" | "REVIEWED" | "ACTIONED";

const STATUSES: AdminReportStatus[] = ["OPEN", "REVIEWED", "ACTIONED"];

const STATUS_VARIANTS: Record<AdminReportStatus, BadgeVariant> = {
  OPEN: "warning",
  REVIEWED: "info",
  ACTIONED: "success",
};

export function ChatReportsClient({
  reports,
  activeStatus,
}: {
  reports: ChatReportRow[];
  activeStatus: AdminReportStatus;
}) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const statusLabel = (s: AdminReportStatus) =>
    s === "OPEN" ? t("adminStatusOpen") : s === "REVIEWED" ? t("adminStatusReviewed") : t("adminStatusActioned");

  async function setStatus(report: ChatReportRow, status: AdminReportStatus) {
    setBusy(`${report.id}:${status}`);
    try {
      await apiFetch(`/api/admin/chat-reports/${report.id}`, { method: "PATCH", body: { status } });
      toast({ title: t("adminUpdated"), variant: "success" });
      router.refresh();
    } catch (err) {
      toast({
        title: t("adminUpdateFailed"),
        description: err instanceof Error ? err.message : undefined,
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
        aria-label={t("adminTitle")}
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
              onClick={() => router.push(`/admin/chatt?status=${status}`)}
              className={cn(
                "whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
                isActive ? "bg-surface-overlay text-holo-cyan shadow-card" : "text-ink-muted hover:text-ink"
              )}
            >
              {statusLabel(status)}
            </button>
          );
        })}
      </div>

      {reports.length === 0 ? (
        <EmptyState title={t("adminEmptyTitle")} description={t("adminEmptyBody")} />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const names = new Map(report.conversation.participants.map((p) => [p.id, p.name]));
            return (
              <Card key={report.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANTS[report.status as AdminReportStatus] ?? "default"}>
                      {statusLabel(report.status as AdminReportStatus)}
                    </Badge>
                    <span className="text-xs text-ink-faint">{fmt.format(new Date(report.createdAt))}</span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {t("adminReporter")}{" "}
                    <Link href={`/profil/${report.reporter.id}`} className="text-ink underline-offset-2 hover:text-holo-cyan hover:underline">
                      {report.reporter.name}
                    </Link>
                    {" · "}
                    {t("adminParticipants")}{" "}
                    {report.conversation.participants.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <Link href={`/profil/${p.id}`} className="text-ink underline-offset-2 hover:text-holo-cyan hover:underline">
                          {p.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                  <p className="text-sm text-ink">
                    <span className="font-medium text-ink-muted">{t("adminReason")}:</span> {report.reason}
                  </p>

                  <details className="rounded-lg border border-surface-border">
                    <summary className="cursor-pointer px-3 py-2 text-sm text-ink-muted hover:text-ink">
                      {t("adminMessages", { count: report.conversation.messages.length })}
                    </summary>
                    {report.conversation.messages.length === 0 ? (
                      <p className="px-3 pb-3 text-sm text-ink-faint">{t("adminNoMessages")}</p>
                    ) : (
                      <ol className="max-h-96 space-y-2 overflow-y-auto px-3 pb-3">
                        {report.conversation.messages.map((m) => (
                          <li key={m.id} className="text-sm">
                            <span className="text-xs text-ink-faint">
                              {fmt.format(new Date(m.createdAt))} ·{" "}
                              {m.senderId ? names.get(m.senderId) ?? m.senderId : t("deletedAccount")}
                            </span>
                            <p className="whitespace-pre-wrap break-words text-ink">{m.body}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>

                  <div className="flex flex-wrap gap-2">
                    {report.status === "OPEN" ? (
                      <>
                        <Button
                          size="sm"
                          loading={busy === `${report.id}:ACTIONED`}
                          disabled={busy !== null && busy !== `${report.id}:ACTIONED`}
                          onClick={() => setStatus(report, "ACTIONED")}
                        >
                          {t("adminMarkHandled")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy === `${report.id}:REVIEWED`}
                          disabled={busy !== null && busy !== `${report.id}:REVIEWED`}
                          onClick={() => setStatus(report, "REVIEWED")}
                        >
                          {t("adminMarkReviewed")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `${report.id}:OPEN`}
                        disabled={busy !== null && busy !== `${report.id}:OPEN`}
                        onClick={() => setStatus(report, "OPEN")}
                      >
                        {t("adminReopen")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
