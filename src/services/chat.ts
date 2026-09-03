/**
 * Meddelanden (direktchatt mellan två användare). All Prisma-kontakt för chatten
 * bor här; API-rutterna är tunna skal och sidorna läser via samma funktioner.
 *
 * Leveransmodellen: skrivningen är sanningen, navet (lib/chat-hub.ts) är
 * transporten. `sendMessage` sparar FÖRST, publicerar sedan till båda parters
 * öppna strömmar och faller till push när mottagaren inte är ansluten. Ingen
 * pollning, ingen timer — varje läsning mot Neon svarar på en handling.
 */
import type { ReportStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { isConnected, publish } from "@/lib/chat-hub";
import { pushToUser } from "@/lib/push-to-user";
import { isBlockedEitherWay } from "@/services/blocks";
import {
  MESSAGES_PAGE_MAX,
  NEW_CONVERSATIONS_PER_DAY,
  SENDS_PER_MINUTE,
  conversationPath,
  pairKeyFor,
  previewOf,
  validateMessageBody,
} from "@/lib/chat-rules";

export interface ChatUserDto {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MessageDto {
  id: string;
  senderId: string | null;
  body: string;
  createdAt: string; // ISO
}

export interface ConversationRowDto {
  id: string;
  /** null = motpartens konto är raderat (deltagarraden kaskaderades bort). */
  other: ChatUserDto | null;
  lastPreview: string | null;
  lastMessageAt: string | null;
  unread: number;
  post?: { id: string; title: string };
}

export interface ConversationDetail {
  id: string;
  post: { id: string; title: string } | null;
  me: { lastReadAt: Date | null };
  other: (ChatUserDto & { lastReadAt: Date | null }) | null;
}

const USER_SELECT = { id: true, name: true, avatarUrl: true } as const;

function toMessageDto(m: {
  id: string;
  senderId: string | null;
  body: string;
  createdAt: Date;
}): MessageDto {
  return { id: m.id, senderId: m.senderId, body: m.body, createdAt: m.createdAt.toISOString() };
}

/**
 * Hämta eller skapa parets samtal. Skapas det: spärr på antal nya samtal per
 * dygn (mot massutskick), och `postId` sparas BARA då — ett befintligt samtal
 * byter aldrig tråd bara för att någon klickade från en annan annons.
 */
export async function getOrCreateConversation(
  me: string,
  otherId: string,
  postId?: string
): Promise<{ id: string; created: boolean }> {
  if (otherId === me) throw new ServiceError(400, "Du kan inte skicka meddelanden till dig själv.");
  const other = await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } });
  if (!other) throw new ServiceError(404, "Användaren hittades inte.");
  if (await isBlockedEitherWay(me, otherId)) {
    throw new ServiceError(403, "Det går inte att skicka meddelanden till den här användaren.");
  }

  const pairKey = pairKeyFor(me, otherId);
  const existing = await prisma.conversation.findUnique({ where: { pairKey }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const limit = await rateLimit(`chat-new:${me}`, NEW_CONVERSATIONS_PER_DAY, 24 * 60 * 60 * 1000);
  if (!limit.ok) {
    throw new ServiceError(429, "Du har startat många nya samtal idag. Försök igen i morgon.");
  }

  // Tråden måste finnas och vara synlig — annars sparas samtalet utan koppling
  // i stället för att neka: samtalet är poängen, tråden är kontext.
  let linkedPostId: string | null = null;
  if (postId) {
    const post = await prisma.communityPost.findFirst({
      where: { id: postId, isHidden: false },
      select: { id: true },
    });
    linkedPostId = post?.id ?? null;
  }

  try {
    const created = await prisma.conversation.create({
      data: {
        pairKey,
        postId: linkedPostId,
        participants: { createMany: { data: [{ userId: me }, { userId: otherId }] } },
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    // Kapplöpning: båda parter tryckte samtidigt → den unika nyckeln stoppar
    // den andra. Då finns samtalet — hämta det i stället för att fela.
    const race = await prisma.conversation.findUnique({ where: { pairKey }, select: { id: true } });
    if (race) return { id: race.id, created: false };
    throw err;
  }
}

/** Antal olästa meddelanden per samtal för användaren — EN fråga, aldrig per rad. */
async function unreadByConversation(me: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ id: string; n: number }[]>`
    SELECT m."conversationId" AS id, COUNT(*)::int AS n
    FROM "ConversationParticipant" cp
    JOIN "Message" m ON m."conversationId" = cp."conversationId"
    WHERE cp."userId" = ${me}
      AND m."createdAt" > COALESCE(cp."lastReadAt", 'epoch'::timestamp)
      AND m."senderId" IS DISTINCT FROM ${me}
    GROUP BY m."conversationId"`;
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Samtalslistan: senast aktiva först, samtal utan meddelanden sist. Två frågor totalt. */
export async function listConversations(me: string): Promise<ConversationRowDto[]> {
  const [conversations, unread] = await Promise.all([
    prisma.conversation.findMany({
      where: { participants: { some: { userId: me } } },
      select: {
        id: true,
        lastPreview: true,
        lastMessageAt: true,
        post: { select: { id: true, title: true } },
        participants: {
          where: { userId: { not: me } },
          select: { user: { select: USER_SELECT } },
        },
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    }),
    unreadByConversation(me),
  ]);

  return conversations.map((c) => ({
    id: c.id,
    other: c.participants[0]?.user ?? null,
    lastPreview: c.lastPreview,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    unread: unread.get(c.id) ?? 0,
    ...(c.post ? { post: c.post } : {}),
  }));
}

/** Samtalet om användaren är deltagare, annars null (→ 404: "finns inte" för utomstående). */
export async function getConversationForUser(
  conversationId: string,
  me: string
): Promise<ConversationDetail | null> {
  const c = await prisma.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId: me } } },
    select: {
      id: true,
      post: { select: { id: true, title: true } },
      participants: { select: { userId: true, lastReadAt: true, user: { select: USER_SELECT } } },
    },
  });
  if (!c) return null;
  const mine = c.participants.find((p) => p.userId === me);
  const theirs = c.participants.find((p) => p.userId !== me);
  return {
    id: c.id,
    post: c.post,
    me: { lastReadAt: mine?.lastReadAt ?? null },
    other: theirs ? { ...theirs.user, lastReadAt: theirs.lastReadAt } : null,
  };
}

export interface ListMessagesOptions {
  /** Allt NYARE än detta id (återanslutning). */
  after?: string;
  /** Sidan ÄLDRE än detta id (bläddra bakåt). */
  before?: string;
  limit?: number;
}

/** Meddelanden i stigande tidsordning. Sekundär sort på id gör markören stabil vid lika tid. */
export async function listMessages(
  conversationId: string,
  opts: ListMessagesOptions = {}
): Promise<MessageDto[]> {
  const take = Math.min(Math.max(opts.limit ?? MESSAGES_PAGE_MAX, 1), MESSAGES_PAGE_MAX);
  const select = { id: true, senderId: true, body: true, createdAt: true } as const;

  if (opts.after) {
    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      cursor: { id: opts.after },
      skip: 1,
      take,
      select,
    });
    return rows.map(toMessageDto);
  }

  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    take,
    select,
  });
  return rows.reverse().map(toMessageDto);
}

/**
 * Skicka. Ordningen är medveten: spara → publicera → push. Publiceringen går
 * även till avsändarens egna strömmar (andra flikar/enheter). Push bara när
 * mottagaren INTE har en ström öppen — då nås hen redan direkt.
 */
export async function sendMessage(
  conversationId: string,
  sender: { id: string; name: string },
  rawBody: unknown
): Promise<MessageDto> {
  const conv = await getConversationForUser(conversationId, sender.id);
  if (!conv) throw new ServiceError(404, "Samtalet hittades inte.");
  if (!conv.other) throw new ServiceError(410, "Kontot du skrev med är raderat.");
  if (await isBlockedEitherWay(sender.id, conv.other.id)) {
    throw new ServiceError(403, "Det går inte att skicka meddelanden i det här samtalet.");
  }

  const validated = validateMessageBody(rawBody);
  if (!validated.ok) throw new ServiceError(400, validated.message);

  const limit = await rateLimit(`chat-send:${sender.id}`, SENDS_PER_MINUTE, 60_000);
  if (!limit.ok) throw new ServiceError(429, "Lugn — du skickar för snabbt. Vänta en minut.");

  // Samma klockslag på meddelandet och på avsändarens lastReadAt: sätts
  // createdAt av databasen kan det hamna efter JS-klockan och ett eget
  // meddelande skulle då se oläst ut för en vakt som jämför tidsstämplar.
  const now = new Date();
  const preview = previewOf(validated.body);
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: sender.id, body: validated.body, createdAt: now },
      select: { id: true, senderId: true, body: true, createdAt: true },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now, lastPreview: preview },
    }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: sender.id } },
      data: { lastReadAt: now },
    }),
  ]);

  const dto = toMessageDto(message);
  const event = { type: "message" as const, conversationId, message: dto };
  const otherId = conv.other.id;
  publish(otherId, event);
  publish(sender.id, event);

  if (!isConnected(otherId)) {
    // Push-texten är serverside och svensk med flit — pushen är inte locale-
    // medveten. Kort: rubriken bär avsändaren, kroppen förhandsvisningen.
    void pushToUser(otherId, {
      title: `Nytt meddelande från ${sender.name}`,
      body: preview,
      url: conversationPath(conversationId),
    }).catch(() => undefined);
  }

  return dto;
}

/** Markera samtalet läst t.o.m. nu och berätta det för motparten ("Läst"). */
export async function markRead(conversationId: string, me: string): Promise<{ readAt: string }> {
  const conv = await getConversationForUser(conversationId, me);
  if (!conv) throw new ServiceError(404, "Samtalet hittades inte.");
  const now = new Date();
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: me } },
    data: { lastReadAt: now },
  });
  const readAt = now.toISOString();
  if (conv.other) publish(conv.other.id, { type: "read", conversationId, userId: me, readAt });
  return { readAt };
}

/** Anmäl samtalet. ⛔ Enda vägen för en moderator in i ett privat samtal. */
export async function reportConversation(
  conversationId: string,
  reporterId: string,
  reason: string
): Promise<{ id: string }> {
  const conv = await getConversationForUser(conversationId, reporterId);
  if (!conv) throw new ServiceError(404, "Samtalet hittades inte.");
  const report = await prisma.chatReport.create({
    data: { conversationId, reporterId, reason: reason.trim() },
    select: { id: true },
  });
  return report;
}

/** Antal samtal med minst ett oläst meddelande — EN fråga (badgen i navigeringen). */
export async function unreadConversationCount(me: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(DISTINCT cp."conversationId")::int AS n
    FROM "ConversationParticipant" cp
    JOIN "Message" m ON m."conversationId" = cp."conversationId"
    WHERE cp."userId" = ${me}
      AND m."createdAt" > COALESCE(cp."lastReadAt", 'epoch'::timestamp)
      AND m."senderId" IS DISTINCT FROM ${me}`;
  return rows[0]?.n ?? 0;
}

// ---------- Moderering ----------

export interface ChatReportRow {
  id: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; name: string };
  conversation: {
    id: string;
    participants: { id: string; name: string }[];
    /** De senaste 30, i stigande tidsordning. */
    messages: MessageDto[];
  };
}

const ADMIN_REPORT_MESSAGES = 30;

export async function listChatReports(status: ReportStatus): Promise<ChatReportRow[]> {
  const rows = await prisma.chatReport.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reason: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      reporter: { select: { id: true, name: true } },
      conversation: {
        select: {
          id: true,
          participants: { select: { user: { select: { id: true, name: true } } } },
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: ADMIN_REPORT_MESSAGES,
            select: { id: true, senderId: true, body: true, createdAt: true },
          },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    reporter: r.reporter,
    conversation: {
      id: r.conversation.id,
      participants: r.conversation.participants.map((p) => p.user),
      messages: r.conversation.messages.reverse().map(toMessageDto),
    },
  }));
}

export async function setChatReportStatus(
  id: string,
  status: ReportStatus
): Promise<{ id: string; status: ReportStatus; resolvedAt: string | null }> {
  const row = await prisma.chatReport.update({
    where: { id },
    data: { status, resolvedAt: status === "OPEN" ? null : new Date() },
    select: { id: true, status: true, resolvedAt: true },
  });
  return { ...row, resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null };
}
