/** Pärmar i samlingen: lista, skapa, döp om, offentlig/privat, ta bort. */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import {
  canCreatePortfolio,
  DEFAULT_PORTFOLIO_NAME,
  normalizePortfolioName,
  PORTFOLIO_LIMIT_CODE,
  portfolioIdForWrite,
  portfolioLimit,
} from "@/lib/portfolio-limit";

export interface PortfolioRow {
  id: string;
  name: string;
  isPublic: boolean;
  isDefault: boolean;
  /** Antal POSTER (rader), inte exemplar — det är rader man flyttar. */
  itemCount: number;
}

const PORTFOLIO_SELECT = {
  id: true,
  name: true,
  isPublic: true,
  isDefault: true,
  createdAt: true,
} as const;

/**
 * Standardpärmen finns för alla konton som fanns vid migrationen; konton
 * skapade därefter får sin första gången samlingen rör vid pärmarna. Skapas
 * lat i stället för i registreringen så att OAuth-, formulär- och seed-vägarna
 * inte behöver minnas det var för sig.
 */
async function ensureDefaultPortfolio(userId: string, locale: "sv" | "en" = "sv") {
  const existing = await prisma.portfolio.findFirst({
    where: { userId, isDefault: true },
    select: PORTFOLIO_SELECT,
  });
  if (existing) return existing;
  // Ärver kontots gamla flagga så att en profil som var offentlig förblir det.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPublicCollection: true },
  });
  if (!user) throw new ServiceError(404, "Användaren hittades inte.");
  return prisma.portfolio.create({
    data: {
      userId,
      name: DEFAULT_PORTFOLIO_NAME[locale],
      isDefault: true,
      isPublic: user.isPublicCollection,
    },
    select: PORTFOLIO_SELECT,
  });
}

/** Alla pärmar, standardpärmen först, sedan i skapelseordning. Med antal poster. */
export async function listPortfolios(
  userId: string,
  opts?: { locale?: "sv" | "en" }
): Promise<PortfolioRow[]> {
  await ensureDefaultPortfolio(userId, opts?.locale);
  const [rows, counts] = await Promise.all([
    prisma.portfolio.findMany({
      where: { userId },
      select: PORTFOLIO_SELECT,
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.collectionItem.groupBy({
      by: ["portfolioId"],
      where: { userId },
      _count: { _all: true },
    }),
  ]);
  const countBy = new Map<string | null, number>();
  for (const c of counts) countBy.set(c.portfolioId, c._count._all);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isPublic: r.isPublic,
    isDefault: r.isDefault,
    itemCount: countBy.get(r.isDefault ? null : r.id) ?? 0,
  }));
}

/** Hur många pärmar kontot får ha och om en till går att skapa. */
export async function portfolioAllowance(userId: string, isPro: boolean) {
  const count = await prisma.portfolio.count({ where: { userId } });
  return { count, limit: portfolioLimit(isPro), canCreate: canCreatePortfolio(count, isPro) };
}

export async function createPortfolio(userId: string, isPro: boolean, rawName: string) {
  const name = normalizePortfolioName(rawName);
  if (!name) throw new ServiceError(400, "Pärmen behöver ett namn.");
  await ensureDefaultPortfolio(userId);
  const count = await prisma.portfolio.count({ where: { userId } });
  if (!canCreatePortfolio(count, isPro)) {
    throw new ServiceError(
      403,
      isPro
        ? "Du har redan så många pärmar som Pro tillåter."
        : "Gratiskontot har en pärm. Uppgradera till Pro för upp till fem.",
      PORTFOLIO_LIMIT_CODE
    );
  }
  const row = await prisma.portfolio.create({
    // Ny pärm är PRIVAT tills ägaren säger något annat — att publicera är ett val.
    data: { userId, name, isDefault: false, isPublic: false },
    select: PORTFOLIO_SELECT,
  });
  return { ...row, itemCount: 0 } satisfies PortfolioRow;
}

async function ownedPortfolio(userId: string, id: string) {
  const row = await prisma.portfolio.findFirst({ where: { id, userId }, select: PORTFOLIO_SELECT });
  if (!row) throw new ServiceError(404, "Pärmen hittades inte.");
  return row;
}

/**
 * `User.isPublicCollection` = "minst en pärm är offentlig". Profilsidan, adminens
 * chip, GDPR-exporten och native-klienter läser flaggan; sanningen bor per pärm.
 */
async function syncUserPublicFlag(userId: string) {
  const anyPublic = (await prisma.portfolio.count({ where: { userId, isPublic: true } })) > 0;
  await prisma.user.updateMany({
    where: { id: userId, isPublicCollection: { not: anyPublic } },
    data: { isPublicCollection: anyPublic },
  });
  return anyPublic;
}

export async function updatePortfolio(
  userId: string,
  id: string,
  input: { name?: string; isPublic?: boolean }
) {
  await ownedPortfolio(userId, id);
  const data: { name?: string; isPublic?: boolean } = {};
  if (input.name !== undefined) {
    const name = normalizePortfolioName(input.name);
    if (!name) throw new ServiceError(400, "Pärmen behöver ett namn.");
    data.name = name;
  }
  if (input.isPublic !== undefined) data.isPublic = input.isPublic;
  const row = await prisma.portfolio.update({ where: { id }, data, select: PORTFOLIO_SELECT });
  if (input.isPublic !== undefined) await syncUserPublicFlag(userId);
  return row;
}

/**
 * Gamla reglaget "Offentlig samling" (Inställningar, native-klienter via
 * PATCH /api/users/me): slår om ALLA pärmar på en gång. Behålls som
 * bakåtkompatibel genväg — per pärm styrs det på /samling.
 */
export async function setAllPortfoliosPublic(userId: string, isPublic: boolean) {
  await ensureDefaultPortfolio(userId);
  await prisma.portfolio.updateMany({ where: { userId }, data: { isPublic } });
  await syncUserPublicFlag(userId);
}

/**
 * Tar bort pärmen. Posterna RADERAS INTE — FK:n är SetNull, så de faller
 * tillbaka i standardpärmen. Standardpärmen själv går inte att ta bort.
 */
export async function deletePortfolio(userId: string, id: string) {
  const row = await ownedPortfolio(userId, id);
  if (row.isDefault) throw new ServiceError(400, "Standardpärmen kan inte tas bort.");
  await prisma.portfolio.delete({ where: { id } });
  await syncUserPublicFlag(userId);
  return { deleted: true };
}

/**
 * Översätter ett inkommande `portfolioId` till det som SKRIVS på posten:
 * undefined ⇒ rör inte (undefined), standardpärmen ⇒ null, annan pärm ⇒ id
 * efter ägarkontroll. Okänd/främmande pärm ⇒ 404 — aldrig tyst standard, då
 * hamnar ett kort i fel pärm utan att någon märker det.
 */
export async function resolvePortfolioIdForWrite(
  userId: string,
  portfolioId: string | null | undefined
): Promise<string | null | undefined> {
  if (portfolioId === undefined) return undefined;
  if (portfolioId === null) return null;
  const row = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId },
    select: { id: true, isDefault: true },
  });
  if (!row) throw new ServiceError(404, "Pärmen hittades inte.");
  return portfolioIdForWrite(row);
}

/** Pärmar som får visas för andra: de offentliga. Standardpärmen först. */
export async function listPublicPortfolios(userId: string) {
  return prisma.portfolio.findMany({
    where: { userId, isPublic: true },
    select: PORTFOLIO_SELECT,
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/** Är posten synlig för andra, dvs ligger den i en offentlig pärm? */
export async function isItemPublic(item: { userId: string; portfolioId: string | null }) {
  const row = item.portfolioId
    ? await prisma.portfolio.findUnique({ where: { id: item.portfolioId }, select: { isPublic: true } })
    : await prisma.portfolio.findFirst({
        where: { userId: item.userId, isDefault: true },
        select: { isPublic: true },
      });
  return row?.isPublic ?? false;
}
