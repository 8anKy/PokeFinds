/**
 * Blockeringar mellan användare. Krav från App Store-riktlinje 1.2 (användar-
 * genererat innehåll): den blockerade kan varken starta eller fortsätta ett
 * samtal med blockeraren. Kontraktet `blockedUserIds`/`isBlockedEitherWay`
 * används även av forumet (döljer trådar/svar) — ändra inte signaturerna.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";

/** Alla id:n som är blockerade ÅT NÅGOT HÅLL relativt användaren, utan dubbletter. */
export async function blockedUserIds(userId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) ids.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  return [...ids];
}

/** Finns en blockering åt något håll mellan a och b? En läsning. */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { blockerId: true },
  });
  return row !== null;
}

/**
 * Vem har blockerat vem? Samtalsvyn behöver skilja på "jag blockerade" (visa
 * Avblockera) och "hen blockerade mig" (bara ett neutralt besked — vi avslöjar
 * aldrig för den blockerade att hen är blockerad). En läsning.
 */
export async function blockStatus(
  me: string,
  other: string
): Promise<{ byMe: boolean; byThem: boolean }> {
  if (me === other) return { byMe: false, byThem: false };
  const rows = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: me, blockedId: other },
        { blockerId: other, blockedId: me },
      ],
    },
    select: { blockerId: true },
  });
  return {
    byMe: rows.some((r) => r.blockerId === me),
    byThem: rows.some((r) => r.blockerId === other),
  };
}

/** Blockera. Idempotent — en andra blockering är ingen konflikt. */
export async function block(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new ServiceError(400, "Du kan inte blockera dig själv.");
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) throw new ServiceError(404, "Användaren hittades inte.");
  await prisma.userBlock.createMany({ data: [{ blockerId, blockedId }], skipDuplicates: true });
}

/** Avblockera. Idempotent — att avblockera någon som inte var blockerad är ofarligt. */
export async function unblock(blockerId: string, blockedId: string): Promise<void> {
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
}

/** Dem JAG har blockerat (aldrig dem som blockerat mig — det ska inte synas). */
export async function listBlocked(userId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    select: { blocked: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => r.blocked);
}
