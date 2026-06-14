import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminRequired } from "../admin-required";
import { UsersTable, type AdminUserRow } from "./users-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

interface PageProps {
  searchParams: { q?: string; page?: string };
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        planTier: true,
        reputationScore: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
  ]);

  const rows: AdminUserRow[] = users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <UsersTable
      users={rows}
      total={total}
      page={page}
      totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
      query={q}
      currentUserId={session.user.id}
      isSuperAdmin={hasRole(session.user.role, "SUPERADMIN")}
    />
  );
}
