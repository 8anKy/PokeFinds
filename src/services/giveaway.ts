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
  type GiveawayConfig,
  type TicketBreakdown,
} from "@/lib/giveaway";
import { discordLinkingEnabled } from "@/lib/discord";
import { inviteeReturned } from "@/services/invites";
import { mapPool } from "@/lib/concurrency";

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

/**
 * Inbjudna under perioden som verifierat OCH kommit tillbaka en senare dag, plus
 * Discord-id:t för dem som gick med i Discord via Scoutr som NYA medlemmar
 * (`Invite.discordJoinedAt`, satt av Discord-kopplingen på 201). Ett redan kopplat
 * eller redan medlem-konto ger ingen lott. Dragningen kollar att de är kvar.
 */
async function loadQualifiedInvites(
  userId: string,
  cfg: GiveawayConfig,
  end: Date
): Promise<{ qualified: number; discordUserIds: string[] }> {
  const invites = await prisma.invite.findMany({
    where: {
      inviterId: userId,
      usedAt: { gte: cfg.countsFrom, lte: end },
      verifiedAt: { not: null },
    },
    select: {
      discordJoinedAt: true,
      usedBy: { select: { createdAt: true, lastSeenAt: true, discordUserId: true } },
    },
  });
  const qualified = invites.filter((i) => inviteeReturned(i.usedBy));
  return {
    qualified: qualified.length,
    discordUserIds: qualified.flatMap((i) =>
      i.discordJoinedAt && i.usedBy?.discordUserId ? [i.usedBy.discordUserId] : []
    ),
  };
}

export interface GiveawayUserTickets {
  joined: boolean;
  tickets: TicketBreakdown;
  counts: {
    scannedCards: number;
    qualifiedInvites: number;
    invitesInDiscord: number;
    hasRestockAlert: boolean;
    discordLinked: boolean;
    facebookFollowed: boolean;
    gradings: number;
  };
  /** För dragningens medlemskapskoll — skickas aldrig till klienten. */
  discordUserId: string | null;
  /** De inbjudna vännernas Discord-id, för samma koll — skickas aldrig till klienten. */
  inviteeDiscordUserIds: string[];
}

/** Okachad — dragningsskriptet läser den här direkt. */
export async function loadUserTickets(
  userId: string,
  cfg: GiveawayConfig = giveawayConfig(),
  now: Date = new Date()
): Promise<GiveawayUserTickets> {
  const end = windowEnd(cfg, now);
  const [entry, scannedCards, invites, restockCount, account, gradings] = await Promise.all([
    prisma.giveawayEntry.findUnique({
      where: { giveaway_userId: { giveaway: cfg.key, userId } },
      select: { facebookFollowedAt: true },
    }),
    countScannedCards(userId, cfg, end),
    loadQualifiedInvites(userId, cfg, end),
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
    qualifiedInvites: invites.qualified,
    invitesInDiscord: invites.discordUserIds.length,
    hasRestockAlert: restockCount > 0,
    discordLinked: !!discordUserId,
    facebookFollowed: !!entry?.facebookFollowedAt,
    gradings,
  };
  return {
    joined: !!entry,
    tickets: computeTickets({ joined: !!entry, ...counts }),
    counts,
    discordUserId,
    inviteeDiscordUserIds: invites.discordUserIds,
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

/**
 * `fresh` = förbi 60 s-cachen. Svaret på anmälan MÅSTE vara färskt: revalidateTag i
 * samma request släpper inte den cachade posten förrän nästa, så anmälan såg ut att
 * inte ha hänt ("Gå med" gjorde ingenting synligt förrän sidan laddades om).
 */
export async function getGiveawayStatus(userId: string | null, opts: { fresh?: boolean } = {}) {
  const info = giveawayPublicInfo();
  if (!userId) return { ...info, user: null };
  const { discordUserId: _omit, inviteeDiscordUserIds: _omitInvitees, ...user } = opts.fresh
    ? await loadUserTickets(userId)
    : await cachedUserTickets(userId);
  return { ...info, user };
}

/** Lotternas cache för EN användare — när något utanför giveawayn ändrat dem (Discord-kopplingen). */
export function invalidateGiveawayUser(userId: string): void {
  revalidateTag(userTag(userId));
}

/**
 * Anmälan = att kryssa i reglerna (ägarbeslut 2026-10-31: inga användarnamn —
 * följ/kommentera kontrolleras på vinnaren, som uppger sina konton via e-post).
 * Kolumnerna `tiktokHandle`/`instagramHandle` står kvar för tidigare anmälningar.
 */
export async function joinGiveaway(userId: string, opts: { preview?: boolean } = {}): Promise<void> {
  const cfg = giveawayConfig();
  const phase = giveawayPhase(cfg, new Date());
  if (phase === "closed") {
    throw new ServiceError(400, "Giveawayn är avslutad.");
  }
  // Dold före starten: bara admin (förhandsvisning) kan anmäla sig.
  if (phase === "upcoming" && !opts.preview) throw new ServiceError(404, "Hittades inte.");
  await prisma.giveawayEntry.upsert({
    where: { giveaway_userId: { giveaway: cfg.key, userId } },
    create: { giveaway: cfg.key, userId },
    update: {},
  });
  revalidateTag(userTag(userId));
}

/**
 * "Följ på Facebook": självdeklarerat (ägarbeslut 2026-10-31) — knappen öppnar sidan och
 * ger lotten, ingen kontroll. Kräver anmälan (lotten bor på anmälningsraden).
 */
export async function markFacebookFollowed(userId: string): Promise<void> {
  const cfg = giveawayConfig();
  if (giveawayPhase(cfg, new Date()) === "closed") throw new ServiceError(400, "Giveawayn är avslutad.");
  await prisma.giveawayEntry.updateMany({
    where: { giveaway: cfg.key, userId, facebookFollowedAt: null },
    data: { facebookFollowedAt: new Date() },
  });
  revalidateTag(userTag(userId));
}

export interface GiveawayAdminFriend {
  name: string | null;
  email: string;
  joinedAt: string;
  /** Kom tillbaka en senare dag ⇒ räknas (ger inbjudaren lotter). */
  counts: boolean;
  /** "link" = länken, "code" = skrev in koden, null = före spårningen (2026-10-31). */
  source: string | null;
  /** Gick med i Discord via Scoutr som NY medlem ⇒ inbjudarens +5. */
  joinedDiscord: boolean;
  discordUsername: string | null;
}

export interface GiveawayAdminRow {
  userId: string;
  name: string | null;
  email: string;
  joinedAt: string;
  tickets: TicketBreakdown;
  counts: GiveawayUserTickets["counts"];
  discordUsername: string | null;
  /** Alla som skapat konto via länken under perioden — även de som ännu inte räknas. */
  friends: GiveawayAdminFriend[];
}

/**
 * Adminens giveaway-flik: varje anmäld med samma lottberäkning som dragningen
 * (`loadUserTickets`), plus vännerna de bjudit in. Okachad och bara när admin
 * öppnar fliken — inga jobb, inga extra väckningar. Discord-medlemskapet kollas
 * INTE här (ett API-anrop per person); det gör dragningen.
 */
export async function loadGiveawayAdmin(now: Date = new Date()): Promise<{
  phase: ReturnType<typeof giveawayPhase>;
  countsFrom: string;
  closesAt: string;
  rows: GiveawayAdminRow[];
}> {
  const cfg = giveawayConfig();
  const end = windowEnd(cfg, now);
  const entries = await prisma.giveawayEntry.findMany({
    where: { giveaway: cfg.key },
    select: {
      userId: true,
      createdAt: true,
      user: { select: { name: true, email: true, discordUsername: true } },
    },
  });
  const invites = await prisma.invite.findMany({
    where: {
      inviterId: { in: entries.map((e) => e.userId) },
      usedAt: { gte: cfg.countsFrom, lte: end },
    },
    orderBy: { usedAt: "asc" },
    select: {
      inviterId: true,
      usedAt: true,
      verifiedAt: true,
      source: true,
      discordJoinedAt: true,
      usedBy: {
        select: { name: true, email: true, createdAt: true, lastSeenAt: true, discordUsername: true },
      },
    },
  });
  const friendsByInviter = new Map<string, GiveawayAdminFriend[]>();
  for (const i of invites) {
    if (!i.usedBy) continue;
    const list = friendsByInviter.get(i.inviterId) ?? [];
    list.push({
      name: i.usedBy.name,
      email: i.usedBy.email,
      joinedAt: (i.usedAt ?? i.usedBy.createdAt).toISOString(),
      counts: !!i.verifiedAt && inviteeReturned(i.usedBy),
      source: i.source,
      joinedDiscord: !!i.discordJoinedAt,
      discordUsername: i.usedBy.discordUsername,
    });
    friendsByInviter.set(i.inviterId, list);
  }

  const rows: GiveawayAdminRow[] = [];
  await mapPool(entries, 4, async (e) => {
    const t = await loadUserTickets(e.userId, cfg, now);
    rows.push({
      userId: e.userId,
      name: e.user.name,
      email: e.user.email,
      joinedAt: e.createdAt.toISOString(),
      tickets: t.tickets,
      counts: t.counts,
      discordUsername: e.user.discordUsername,
      friends: friendsByInviter.get(e.userId) ?? [],
    });
  });
  rows.sort((a, b) => b.tickets.total - a.tickets.total);
  return {
    phase: giveawayPhase(cfg, now),
    countsFrom: cfg.countsFrom.toISOString(),
    closesAt: cfg.closesAt.toISOString(),
    rows,
  };
}
