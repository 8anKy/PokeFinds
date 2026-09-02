import type { Prisma } from "@prisma/client";
import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPro } from "@/lib/plan";
import { renewalStatus } from "@/lib/subscription-status";
import { parseNotificationSettings } from "@/lib/notification-settings";
import {
  COST_WINDOW_DAYS,
  loadUserCosts,
  type UserCostSummary,
} from "@/services/admin/user-costs";
import { utcDaysAgo } from "@/lib/utils";
import { AdminRequired } from "../admin-required";
import { UsersTable, type AdminUserRow } from "./users-table";
import {
  isDbSortable,
  needsAllCosts,
  parseUserSort,
  userOrderBy,
  type ComputedSortKey,
  type SortDir,
} from "./users-sort";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/** Fälten listan renderar. Ett utelämnat fält blir `undefined` i isPro(). */
const ROW_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  planTier: true,
  bonusProUntil: true,
  // ⛔ `stripeProUntil` MÅSTE väljas när raden matar isPro() — ett ovalt
  // fält blir `undefined` och vakten failar ÖPPET (se CLAUDE.md, Stripe).
  stripeProUntil: true,
  // Prenumerationsstatus (2026-09-02): förnyas den, sedan när, sandbox eller ej.
  stripeCancelAtPeriodEnd: true,
  rcWillRenew: true,
  rcEnvironment: true,
  proSince: true,
  reputationScore: true,
  emailVerifiedAt: true,
  notificationSettings: true,
  lastSeenAt: true,
  createdAt: true,
  // Enheter = beviset på att appen är INSTALLERAD (se users-table.tsx).
  pushTokens: { select: { platform: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof ROW_SELECT }>;

interface PageProps {
  searchParams: { q?: string; page?: string; sort?: string; dir?: string };
}

/**
 * Sorteringsvärdet för de kolumner Postgres inte kan ordna.
 *
 * `plan` mäter EFFEKTIV Pro (isPro), inte `planTier`: bricka och sortering måste
 * säga samma sak, annars hamnar en Stripe-kund bland "Gratis" på en rad som
 * synligt visar "Pro". `cost`/`usage` läser den redan hämtade kostnadssumman.
 */
function computedRank(
  sort: ComputedSortKey,
  user: { planTier: UserRow["planTier"]; role: UserRow["role"]; bonusProUntil: Date | null; stripeProUntil: Date | null },
  cost: UserCostSummary | undefined
): number {
  switch (sort) {
    case "plan":
      return isPro(user) ? 1 : 0;
    // Kostnaden sorteras på det UPPMÄTTA beloppet — det är talet kolumnen visar.
    // De omätta raderna räknas inte in (de har inget belopp), utan står kvar som
    // "+N omätta" bredvid; se user-costs.ts om varför de aldrig blir en nolla.
    case "cost":
      return cost?.totalOre ?? 0;
    case "usage":
      return (cost?.scanner.rows ?? 0) + (cost?.grading.rows ?? 0);
    default: {
      // ⛔ Ingen tyst reserv: en ny beräknad kolumn som glöms här hade annars
      //    ärvt föregående grens tal och sorterat på FEL värde utan att något
      //    går sönder. `never` gör glömskan till ett KOMPILERINGSfel.
      const missing: never = sort;
      throw new Error(`computedRank saknar gren för "${String(missing)}"`);
    }
  }
}

/**
 * De beräknade sorteringarna: rangordna HELA träffmängden, skiva sedan sidan.
 *
 * ⛔ Ingen kandidattak här (till skillnad från katalogfeeden, som fönstrar på 500).
 *    Kolumnen finns för att svara på "vem kostar mest av ALLA" — ett tyst fönster
 *    hade gjort svaret "mest av ett godtyckligt urval". Frågorna grupperar i
 *    Postgres och returnerar en handfull rader oavsett antal användare, och
 *    id-listan är ett fält per konto. Växer tabellen till en storlek där det
 *    svider är svaret en materialiserad kostnadskolumn, inte ett dolt tak.
 */
async function rankComputed(
  where: Prisma.UserWhereInput,
  sort: ComputedSortKey,
  dir: SortDir,
  page: number,
  since: Date
): Promise<{ ids: string[]; total: number; costs: Map<string, UserCostSummary> | null }> {
  const all = await prisma.user.findMany({
    where,
    select: {
      id: true,
      planTier: true,
      role: true,
      bonusProUntil: true,
      stripeProUntil: true,
    },
  });

  const costs = needsAllCosts(sort)
    ? await loadUserCosts(
        all.map((u) => u.id),
        since
      )
    : null;

  const sign = dir === "asc" ? 1 : -1;
  const ranked = all
    .map((u) => ({ id: u.id, rank: computedRank(sort, u, costs?.get(u.id)) }))
    // `id` sist av samma skäl som i userOrderBy(): utan ett unikt led är
    // ordningen inom en grupp (alla "0 kr", alla "Gratis") godtycklig, och
    // sidbrytningen kan då tappa eller dubblera en användare.
    .sort((a, b) => (a.rank - b.rank) * sign || a.id.localeCompare(b.id));

  return {
    ids: ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => r.id),
    total: ranked.length,
    costs,
  };
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const { sort, dir } = parseUserSort(searchParams.sort, searchParams.dir);

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const since = utcDaysAgo(COST_WINDOW_DAYS);

  let users: UserRow[];
  let total: number;
  // Kostnaderna för de 25 raderna. Sorterar vi PÅ kostnad är de redan hämtade
  // för hela träffmängden — då körs kostnadsfrågan en gång, inte två.
  let costs: Map<string, UserCostSummary>;

  if (isDbSortable(sort)) {
    [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: ROW_SELECT,
        orderBy: userOrderBy(sort, dir),
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.user.count({ where }),
    ]);
    // EN kostnadsfråga för hela sidan, inte en per användare — se user-costs.ts.
    costs = await loadUserCosts(
      users.map((u) => u.id),
      since
    );
  } else {
    const ranked = await rankComputed(where, sort, dir, page, since);
    total = ranked.total;
    costs = ranked.costs ?? (await loadUserCosts(ranked.ids, since));
    // ⛔ `in` ger raderna i DATABASENS ordning, inte listans — utan den här
    //    omsorteringen hade sidan visat rätt 25 användare i fel ordning, vilket
    //    ser ut som att sorteringen "nästan" fungerar.
    const byId = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: ranked.ids } },
          select: ROW_SELECT,
        })
      ).map((u) => [u.id, u])
    );
    users = ranked.ids.map((id) => byId.get(id)).filter((u): u is UserRow => u !== undefined);
  }

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
      renewal: renewalStatus(u),
      proSince: u.proSince ? u.proSince.toISOString().slice(0, 10) : null,
      sandbox: u.rcEnvironment === "SANDBOX",
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
      sort={sort}
      dir={dir}
      currentUserId={session.user.id}
      isSuperAdmin={hasRole(session.user.role, "SUPERADMIN")}
      costWindowDays={COST_WINDOW_DAYS}
    />
  );
}
