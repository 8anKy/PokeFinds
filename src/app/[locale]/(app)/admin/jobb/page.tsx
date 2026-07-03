import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminRequired } from "../admin-required";
import { JobsClient, type JobRow } from "./jobs-client";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const jobs = await prisma.scrapeJob.findMany({
    include: { source: { select: { name: true, type: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const rows: JobRow[] = jobs.map((j) => ({
    id: j.id,
    sourceName: j.source.name,
    status: j.status,
    startedAt: j.startedAt ? j.startedAt.toISOString() : null,
    finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
    createdAt: j.createdAt.toISOString(),
    itemsFound: j.itemsFound,
    itemsUpdated: j.itemsUpdated,
    errorMessage: j.errorMessage,
    logs: Array.isArray(j.logs) ? (j.logs as unknown[]).map((l) => String(l)) : [],
  }));

  return <JobsClient jobs={rows} />;
}
