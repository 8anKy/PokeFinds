/**
 * Meddelandenas rena regler — ingen Prisma, ingen Next. Allt som går att
 * avgöra utan databasen bor här så det kan testas utan miljö
 * (tests/unit/chat-rules.test.ts) och delas av API, sidor och klient.
 */

/** Max längd på ett meddelande (tecken efter trimning). */
export const MESSAGE_MAX_CHARS = 2000;
/** Förhandsvisningen i samtalslistan — de första tecknen, aldrig hela texten. */
export const PREVIEW_CHARS = 80;
/** Anmälningsskälets längd. */
export const REPORT_REASON_MIN = 5;
export const REPORT_REASON_MAX = 500;
/** Nya samtal per användare och dygn — spärr mot massutskick till främlingar. */
export const NEW_CONVERSATIONS_PER_DAY = 20;
/** Skickade meddelanden per minut. */
export const SENDS_PER_MINUTE = 30;
/** Största sida vid hämtning av meddelanden. */
export const MESSAGES_PAGE_MAX = 50;

/**
 * Nyckeln som gör paret unikt: de två id:na sorterade och sammanfogade. Samma
 * nyckel oavsett vem som startar samtalet → ett par har alltid EXAKT ett samtal
 * (Conversation.pairKey är @unique).
 */
export function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join(":");
}

/** Motpartens id ur en pairKey — eller null om jag inte är med i paret. */
export function otherIdFromPairKey(pairKey: string, me: string): string | null {
  const [a, b] = pairKey.split(":");
  if (a === me) return b ?? null;
  if (b === me) return a;
  return null;
}

/** Radbrytningar och dubbla mellanslag ihopslagna, kapat till PREVIEW_CHARS. */
export function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  return flat.slice(0, PREVIEW_CHARS - 1).trimEnd() + "…";
}

export type BodyValidation = { ok: true; body: string } | { ok: false; message: string };

/**
 * Normaliserar och vaktar ett meddelande: CRLF → LF, trimning, längd. Returnerar
 * den text som ska SPARAS — anroparen får aldrig spara originalet.
 */
export function validateMessageBody(input: unknown): BodyValidation {
  if (typeof input !== "string") return { ok: false, message: "Meddelandet saknas." };
  const body = input.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length === 0) return { ok: false, message: "Skriv något först." };
  if (body.length > MESSAGE_MAX_CHARS) {
    return { ok: false, message: `Max ${MESSAGE_MAX_CHARS} tecken.` };
  }
  return { ok: true, body };
}

export interface UnreadCandidate {
  createdAt: Date | string;
  senderId: string | null;
}

/**
 * Är meddelandet oläst för den som senast läste vid `lastReadAt`? Egna
 * meddelanden räknas aldrig som olästa (skicka in `viewerId`). Ett meddelande
 * från ett raderat konto (senderId null) är motpartens och kan vara oläst.
 */
export function isUnread(
  lastReadAt: Date | string | null | undefined,
  message: UnreadCandidate,
  viewerId?: string
): boolean {
  if (viewerId && message.senderId === viewerId) return false;
  if (!lastReadAt) return true;
  return new Date(message.createdAt).getTime() > new Date(lastReadAt).getTime();
}

/** Samma kalenderdag i den LOKALA tidszonen (dagavskiljare i vyn). */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type DayLabel = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; date: Date };

/** Vilken etikett en dagavskiljare ska bära, relativt `now`. */
export function dayLabelFor(date: Date, now: Date = new Date()): DayLabel {
  if (isSameLocalDay(date, now)) return { kind: "today" };
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return { kind: "yesterday" };
  return { kind: "date", date };
}

export type RelativeLabel =
  | { kind: "now" }
  | { kind: "minutes"; count: number }
  | { kind: "hours"; count: number }
  | { kind: "days"; count: number }
  | { kind: "date"; date: Date };

/**
 * Relativ tid för samtalslistan ("nyss", "5 min", "3 tim", "2 d", annars datum).
 * Ren beräkning — texten sätts av översättningarna, aldrig här.
 */
export function relativeLabelFor(date: Date | string, now: Date = new Date()): RelativeLabel {
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { kind: "now" };
  if (minutes < 60) return { kind: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: "hours", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { kind: "days", count: days };
  return { kind: "date", date: d };
}

export interface Orderable {
  id: string;
  createdAt: Date | string;
}

/**
 * Slå ihop två meddelandelistor utan dubbletter, i tidsordning (id som sekundär
 * nyckel, samma som databasens sortering). Samma meddelande kan nå vyn två
 * gånger — svaret på POST och kopian ur strömmen — och vid återanslutning
 * överlappar `?after=` ibland det som redan finns.
 */
export function mergeMessages<T extends Orderable>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Initialen i avatar-platshållaren. Tom sträng → "?" så cirkeln aldrig är tom. */
export function avatarInitial(name: string | null | undefined): string {
  const first = (name ?? "").trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/** Appens väg till ett samtal — EN definition, används av push, listor och navigering. */
export function conversationPath(conversationId: string): string {
  return `/meddelanden/${conversationId}`;
}

/** Forumtrådens väg (forumets rutt är /forum/t/<id>). */
export function threadPath(postId: string): string {
  return `/forum/t/${postId}`;
}
