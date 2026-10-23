/**
 * Giveaway — läsning och anmälan (regler + lottmodell: src/lib/giveaway.ts).
 *
 * ⛔ Lotterna LAGRAS INTE. De räknas ur data som redan finns (skanningar,
 * samlingen, inbjudningar, bevakningar) — en lottabell hade varit en andra
 * sanning som kan glida från samlingen (ett borttaget kort ska dra av lotten).
 * Användarens vy cachas 60 s per userId (kostnadsdoktrinen: personliga svar
 * cachas, egen nyckel) och invalideras vid anmälan.
 */
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { cachedReadTagged } from "@/lib/cache";
import { ServiceError } from "@/lib/errors";
import {
  computeTickets,
  giveawayConfig,
  giveawayPhase,
  normalizeHandle,
  type GiveawayConfig,
  type TicketBreakdown,
} from "@/lib/giveaway";
import { discordLinkingEnabled } from "@/lib/discord";
import { inviteeReturned } from "@/services/invites";

const PERSONAL_TTL_SECONDS = 60;
const userTag = (userId: string) => `giveaway:${userId}`;

/** Lotterna "räknas fram till" — nu, eller slutet om giveawayn är över. */
function windowEnd(cfg: GiveawayConfig, now: Date): Date {
  return now.getTime() < cfg.closesAt.getTime() ? now : cfg.closesAt;
}

/**
 * Skannern lade ett kort i samlingen: bokför det på skanningen. Ett jobb = ett
 * kort (`addedCardId: null` i villkoret), FAILED räknas inte. Fel här får ALDRIG
 * stoppa tillägget i samlingen — anroparen sväljer.
 */
export async function markScanAdded(userId: string, scanJobId: string, cardId: string): Promise<void> {
  await prisma.scannerJob.updateMany({
    where: { id: scanJobId, userId, addedCardId: null, status: { not: "FAILED" } },
    data: { addedCardId: cardId },
  });
}

/** Unika skannade kort under perioden som FORTFARANDE ligger i samlingen. */
async function countScannedCards(userId: string, cfg: GiveawayConfig, end: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT j."addedCardId") AS n
    FROM "ScannerJob" j
    WHERE j."userId" = ${userId}
      AND j."addedCardId" IS NOT NULL
      AND j."status" <> 'FAILED'
      AND j."createdAt" >= ${cfg.countsFrom}
      AND j."createdAt" <= ${end}
      AND EXISTS (
        SELECT 1 FROM "CollectionItem" c
        WHERE c."userId" = j."userId" AND c."cardId" = j."addedCardId"
      )`;
  return Number(rows[0]?.n ?? 0);
}

/** Inbjudna under perioden som verifierat OCH kommit tillbaka en senare dag. */
async function countQualifiedInvites(userId: string, cfg: GiveawayConfig, end: Date): Promise<number> {
  const invites = await prisma.invite.findMany({
    where: {
      inviterId: userId,
      usedAt: { gte: cfg.countsFrom, lte: end },
      verifiedAt: { not: null },
    },
    select: { usedBy: { select: { createdAt: true, lastSeenAt: true } } },
  });
  return invites.filter((i) => inviteeReturned(i.usedBy)).length;
}

export interface GiveawayUserTickets {
  joined: boolean;
  tiktokHandle: string | null;
  instagramHandle: string | null;
  tickets: TicketBreakdown;
  counts: {
    scannedCards: number;
    qualifiedInvites: number;
    hasRestockAlert: boolean;
    discordLinked: boolean;
    gradings: number;
  };
  /** För dragningens medlemskapskoll — skickas aldrig till klienten. */
  discordUserId: string | null;
}

/** Okachad — dragningsskriptet läser den här direkt. */
export async function loadUserTickets(
  userId: string,
  cfg: GiveawayConfig = giveawayConfig(),
  now: Date = new Date()
): Promise<GiveawayUserTickets> {
  const end = windowEnd(cfg, now);
  const [entry, scannedCards, qualifiedInvites, restockCount, account, gradings] = await Promise.all([
    prisma.giveawayEntry.findUnique({
      where: { giveaway_userId: { giveaway: cfg.key, userId } },
      select: { tiktokHandle: true, instagramHandle: true },
    }),
    countScannedCards(userId, cfg, end),
    countQualifiedInvites(userId, cfg, end),
    prisma.watchlistItem.count({ where: { userId, restockAlert: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { discordUserId: true } }),
    // Bara KLARA graderingar under perioden — ett misslyckat anrop är ingen gradering.
    prisma.gradingJob.count({
      where: { userId, status: "COMPLETED", createdAt: { gte: cfg.countsFrom, lte: end } },
    }),
  ]);
  const discordUserId = account?.discordUserId ?? null;
  const counts = {
    scannedCards,
    qualifiedInvites,
    hasRestockAlert: restockCount > 0,
    discordLinked: !!discordUserId,
    gradings,
  };
  return {
    joined: !!entry,
    tiktokHandle: entry?.tiktokHandle ?? null,
    instagramHandle: entry?.instagramHandle ?? null,
    tickets: computeTickets({ joined: !!entry, ...counts }),
    counts,
    discordUserId,
  };
}

const cachedUserTickets = cachedReadTagged(
  (userId: string) => loadUserTickets(userId),
  "giveawayUserTicketsPersonal",
  (userId: string) => userTag(userId),
  PERSONAL_TTL_SECONDS,
  []
);

export function giveawayPublicInfo(now: Date = new Date()) {
  const cfg = giveawayConfig();
  return {
    key: cfg.key,
    phase: giveawayPhase(cfg, now),
    startsAt: cfg.startsAt.toISOString(),
    closesAt: cfg.closesAt.toISOString(),
    /** "Koppla Discord" finns (env) — annars döljs Discord-raden. */
    discordAvailable: discordLinkingEnabled(),
  };
}

export async function getGiveawayStatus(userId: string | null) {
  const info = giveawayPublicInfo();
  if (!userId) return { ...info, user: null };
  const { discordUserId: _omit, ...user } = await cachedUserTickets(userId);
  return { ...info, user };
}

/** Lotternas cache för EN användare — när något utanför giveawayn ändrat dem (Discord-kopplingen). */
export function invalidateGiveawayUser(userId: string): void {
  revalidateTag(userTag(userId));
}

export async function joinGiveaway(
  userId: string,
  input: { tiktokHandle: string; instagramHandle: string },
  opts: { preview?: boolean } = {}
): Promise<void> {
  const cfg = giveawayConfig();
  const phase = giveawayPhase(cfg, new Date());
  if (phase === "closed") {
    throw new ServiceError(400, "Giveawayn är avslutad.");
  }
  // Dold före starten: bara admin (förhandsvisning) kan anmäla sig.
  if (phase === "upcoming" && !opts.preview) throw new ServiceError(404, "Hittades inte.");
  const tiktokHandle = normalizeHandle(input.tiktokHandle);
  const instagramHandle = normalizeHandle(input.instagramHandle);
  if (!tiktokHandle || !instagramHandle) {
    throw new ServiceError(400, "Ange giltiga användarnamn för TikTok och Instagram.");
  }
  await prisma.giveawayEntry.upsert({
    where: { giveaway_userId: { giveaway: cfg.key, userId } },
    create: { giveaway: cfg.key, userId, tiktokHandle, instagramHandle },
    update: { tiktokHandle, instagramHandle },
  });
  revalidateTag(userTag(userId));
}
