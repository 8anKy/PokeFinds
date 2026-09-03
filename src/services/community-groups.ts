/**
 * Forumets grupper. Kurerade (skapas av migration/admin) — ingen `createGroup`
 * här med flit, se kommentaren på modellen i schema.prisma.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Ritas INTE längre (ägarbeslut 2026-09-03: för många emojis). Kvar i modellen, ingen migration. */
  emoji: string | null;
  sortOrder: number;
  isMarketplace: boolean;
  memberCount: number;
  threadCount: number;
}

const GROUP_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  emoji: true,
  sortOrder: true,
  isMarketplace: true,
  _count: { select: { members: true, posts: { where: { isHidden: false } } } },
} as const;

type GroupRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string | null;
  sortOrder: number;
  isMarketplace: boolean;
  _count: { members: number; posts: number };
};

function toSummary(g: GroupRow): GroupSummary {
  const { _count, ...rest } = g;
  return { ...rest, memberCount: _count.members, threadCount: _count.posts };
}

/** Alla grupper i visningsordning — EN fråga, räknarna via _count. */
export async function listGroups(): Promise<GroupSummary[]> {
  const rows = await prisma.communityGroup.findMany({
    select: GROUP_SELECT,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getGroupBySlug(slug: string): Promise<GroupSummary | null> {
  const row = await prisma.communityGroup.findUnique({ where: { slug }, select: GROUP_SELECT });
  return row ? toSummary(row) : null;
}

async function requireGroupId(slug: string): Promise<string> {
  const g = await prisma.communityGroup.findUnique({ where: { slug }, select: { id: true } });
  if (!g) throw new ServiceError(404, "Gruppen hittades inte.");
  return g.id;
}

/** Idempotent: att gå med två gånger är inte ett fel. */
export async function joinGroup(slug: string, userId: string): Promise<{ joined: true }> {
  const groupId = await requireGroupId(slug);
  await prisma.communityGroupMember.createMany({
    data: [{ groupId, userId }],
    skipDuplicates: true,
  });
  return { joined: true };
}

/** Idempotent: att lämna en grupp man inte är med i är ofarligt. */
export async function leaveGroup(slug: string, userId: string): Promise<{ joined: false }> {
  const groupId = await requireGroupId(slug);
  await prisma.communityGroupMember.deleteMany({ where: { groupId, userId } });
  return { joined: false };
}

export async function joinedGroupIds(userId: string): Promise<string[]> {
  const rows = await prisma.communityGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}
