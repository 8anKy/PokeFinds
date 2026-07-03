import { prisma } from "@/lib/db";
import { ReportStatus } from "@prisma/client";
import { ReportsClient, type ReportRow } from "./reports-client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { status?: string };
}

function parseStatus(value: string | undefined): ReportStatus {
  if (value && (Object.values(ReportStatus) as string[]).includes(value)) {
    return value as ReportStatus;
  }
  return "OPEN";
}

export default async function AdminReportsPage({ searchParams }: PageProps) {
  const status = parseStatus(searchParams.status);

  const reports = await prisma.report.findMany({
    where: { status },
    include: {
      post: {
        select: {
          id: true,
          title: true,
          isHidden: true,
          user: { select: { id: true, name: true } },
        },
      },
      reporter: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const rows: ReportRow[] = reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    reporterName: r.reporter.name,
    post: {
      id: r.post.id,
      title: r.post.title,
      isHidden: r.post.isHidden,
      authorName: r.post.user.name,
    },
  }));

  return <ReportsClient reports={rows} activeStatus={status} />;
}
