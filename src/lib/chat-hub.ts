/**
 * In-memory-nav för meddelandeleverans (SSE). ⛔ RÖR ALDRIG DATABASEN.
 *
 * Varje inloggad klient med meddelandevyn öppen håller EN ström mot
 * /api/chat/stream. Navet vet vilka användare som är anslutna just nu och
 * skriver händelser direkt in i deras strömmar. Det är hela leveransen: när ett
 * meddelande sparats (en skrivning) publiceras det här — ingen pollning, ingen
 * timer, ingen fråga mot Neon för att "kolla om det kommit något".
 *
 * Den som INTE är ansluten (appen i bakgrunden, telefonen i fickan) nås via
 * push (lib/apns.ts) — `isConnected()` är signalen som avgör vilket.
 *
 * EN process. Railway kör en replika; navet lever i den. Skulle appen någon gång
 * köra på två replikor måste publiceringen gå via en delad kanal (Redis pub/sub)
 * — inte via databasen.
 *
 * Minnesåtervinningen (lib/memory-recycle.ts) startar om processen några gånger
 * per dygn ⇒ alla strömmar bryts. EventSource återansluter själv, och klienten
 * hämtar "allt sedan senaste meddelande-id" vid återanslutning (se
 * /api/chat/conversations/[id]/messages?after=). Inget tappas — meddelandet
 * sparades FÖRE publiceringen.
 *
 * Ren fil (ingen Next-, ingen Prisma-import) → testbar utan miljö:
 * tests/unit/chat-hub.test.ts.
 */

export type ChatEvent =
  | {
      type: "message";
      conversationId: string;
      message: {
        id: string;
        senderId: string | null;
        body: string;
        createdAt: string; // ISO
      };
    }
  | { type: "read"; conversationId: string; userId: string; readAt: string }
  | { type: "typing"; conversationId: string; userId: string };

type Listener = (event: ChatEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Registrera en ström. Returnerar avregistreringen — anropa den när strömmen stängs. */
export function subscribe(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(userId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listeners.delete(userId);
  };
}

/** Skriv en händelse till ALLA strömmar användaren har öppna (flera flikar/enheter). */
export function publish(userId: string, event: ChatEvent): number {
  const set = listeners.get(userId);
  if (!set || set.size === 0) return 0;
  let delivered = 0;
  for (const l of set) {
    try {
      l(event);
      delivered++;
    } catch {
      // En trasig ström får inte stoppa de andra. Städas när dess avregistrering körs.
    }
  }
  return delivered;
}

/** Är användaren ansluten just nu? Avgör push kontra direktleverans. */
export function isConnected(userId: string): boolean {
  return (listeners.get(userId)?.size ?? 0) > 0;
}

/** Antal öppna strömmar totalt — för /api/health och felsökning. */
export function connectionCount(): number {
  let n = 0;
  for (const s of listeners.values()) n += s.size;
  return n;
}

/** Bara för tester. */
export function _resetHub(): void {
  listeners.clear();
}

/** SSE-serialisering: en händelse = `event:`-rad + `data:`-rad + tom rad. */
export function encodeSse(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Hjärtslag så proxyn inte stänger en tyst ström. En kommentarsrad ignoreras av EventSource. */
export const SSE_HEARTBEAT = ": ping\n\n";
export const SSE_HEARTBEAT_MS = 25_000;
