import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminRequired } from "../admin-required";
import { SourcesClient, type SourceRow } from "./sources-client";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const sources = await prisma.scrapeSource.findMany({
    include: { _count: { select: { jobs: true } } },
    orderBy: { name: "asc" },
  });

  const rows: SourceRow[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    baseUrl: s.baseUrl,
    type: s.type,
    isActive: s.isActive,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    jobCount: s._count.jobs,
  }));

  return <SourcesClient sources={rows} />;
}
