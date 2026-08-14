import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPro } from "@/lib/plan";
import { parseNotificationSettings } from "@/lib/notification-settings";
import { COST_WINDOW_DAYS, loadUserCosts } from "@/services/admin/user-costs";
import { utcDaysAgo } from "@/lib/utils";
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
        bonusProUntil: true,
        // ⛔ `stripeProUntil` MÅSTE väljas när raden matar isPro() — ett ovalt
        // fält blir `undefined` och vakten failar ÖPPET (se CLAUDE.md, Stripe).
        stripeProUntil: true,
        reputationScore: true,
        emailVerifiedAt: true,
        notificationSettings: true,
        lastSeenAt: true,
        createdAt: true,
        // Enheter = beviset på att appen är INSTALLERAD (se users-table.tsx).
        pushTokens: { select: { platform: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
  ]);

  // EN kostnadsfråga för hela sidan, inte en per användare — se user-costs.ts.
  const since = utcDaysAgo(COST_WINDOW_DAYS);
  const costs = await loadUserCosts(
    users.map((u) => u.id),
    since
  );

  const rows: AdminUserRow[] = users.map((u) => {
    const notif = parseNotificationSettings(u.notificationSettings);
    const cost = costs.get(u.id);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      planTier: u.planTier,
      // Bara datumdelen: <input type="date"> vill ha YYYY-MM-DD, och gåvan är
      // dagsupplöst ändå (servern lägger på slutet av dygnet vid skrivning).
      bonusProUntil: u.bonusProUntil ? u.bonusProUntil.toISOString().slice(0, 10) : null,
      isPro: isPro(u),
      reputationScore: u.reputationScore,
      emailVerified: u.emailVerifiedAt !== null,
      notifications: notif,
      devices: u.pushTokens.map((t) => t.platform),
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      costOre: cost?.totalOre ?? 0,
      costUnmeasured: cost?.totalUnmeasured ?? 0,
      scanRows: cost?.scanner.rows ?? 0,
      gradeRows: cost?.grading.rows ?? 0,
    };
  });

  return (
    <UsersTable
      users={rows}
      total={total}
      page={page}
      totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
      query={q}
      currentUserId={session.user.id}
      isSuperAdmin={hasRole(session.user.role, "SUPERADMIN")}
      costWindowDays={COST_WINDOW_DAYS}
    />
  );
}
