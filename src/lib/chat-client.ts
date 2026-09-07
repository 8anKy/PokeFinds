"use client";

/**
 * Klientsidan av chatten: strömmen (SSE) + de få anrop vyn gör. Typerna delas
 * med tjänsten via `import type` — ingen Prisma följer med i buntet.
 */
import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/client-api";
import type { ChatEvent } from "@/lib/chat-hub";
import type { MessageDto } from "@/services/chat";

export type { ChatUserDto, ConversationRowDto, MessageDto } from "@/services/chat";

export interface ChatStreamHandlers {
  onMessage: (conversationId: string, message: MessageDto) => void;
  onRead?: (conversationId: string, userId: string, readAt: string) => void;
  /**
   * Strömmen kom tillbaka efter ett avbrott (minnesåtervinningen startar om
   * processen några gånger per dygn). Vyn hämtar då allt sedan sitt senaste
   * meddelande-id — inget tappas, meddelandet sparades före publiceringen.
   */
  onReconnect?: () => void;
  onStatus?: (connected: boolean) => void;
}

/**
 * EN EventSource per monterad vy. Hanterarna läses via ref så att en ny
 * funktionsidentitet per rendering inte river upp anslutningen.
 */
export function useChatStream(enabled: boolean, handlers: ChatStreamHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;

    const es = new EventSource("/api/chat/stream", { withCredentials: true });
    let dropped = false;

    es.onopen = () => {
      if (dropped) {
        dropped = false;
        ref.current.onReconnect?.();
      }
      ref.current.onStatus?.(true);
    };
    es.onerror = () => {
      // Webbläsaren återansluter själv (utom vid 401/404 → CLOSED, då är det
      // inget att vänta på). Flaggan gör att nästa `open` läses som återkomst.
      dropped = true;
      ref.current.onStatus?.(false);
    };

    const parse = (e: MessageEvent): ChatEvent | null => {
      try {
        return JSON.parse(String(e.data)) as ChatEvent;
      } catch {
        return null;
      }
    };
    // `event: message` är SSE:s standardnamn → landar i onmessage.
    es.onmessage = (e) => {
      const ev = parse(e);
      if (ev?.type === "message") ref.current.onMessage(ev.conversationId, ev.message);
    };
    es.addEventListener("read", (e) => {
      const ev = parse(e as MessageEvent);
      if (ev?.type === "read") ref.current.onRead?.(ev.conversationId, ev.userId, ev.readAt);
    });

    return () => {
      es.close();
      ref.current.onStatus?.(false);
    };
  }, [enabled]);
}

// ---------- Anrop ----------

export function fetchMessages(
  conversationId: string,
  opts: { after?: string; before?: string; limit?: number }
): Promise<MessageDto[]> {
  const q = new URLSearchParams();
  if (opts.after) q.set("after", opts.after);
  if (opts.before) q.set("before", opts.before);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return apiFetch<MessageDto[]>(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ""}`
  );
}

export function postMessage(conversationId: string, body: string): Promise<MessageDto> {
  return apiFetch<MessageDto>(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "POST", body: { body } }
  );
}

export function markConversationRead(conversationId: string): Promise<{ readAt: string }> {
  return apiFetch<{ readAt: string }>(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: "POST" }
  );
}

export function reportConversation(conversationId: string, reason: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/report`,
    { method: "POST", body: { reason } }
  );
}

/** Kontrakt 1: starta/hämta parets samtal → `{ id }`; klienten går sedan till /meddelanden/<id>. */
export function startConversation(userId: string, postId?: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/chat/conversations", {
    method: "POST",
    body: postId ? { userId, postId } : { userId },
  });
}

export function setBlocked(userId: string, blocked: boolean): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/chat/blocks", {
    method: blocked ? "POST" : "DELETE",
    body: { userId },
  });
}

// ---------- Vad vyn redan sett ----------

/**
 * ⛔ NEXTS KLIENT-ROUTERCACHE SERVERAR SAMMA RSC-NYTTOLAST I 30 SEKUNDER för en
 * dynamisk rutt. Gick man ut ur ett samtal och in igen direkt efter att ha
 * skickat ett meddelande renderades sidan alltså ur den cachade nyttolasten —
 * utan meddelandet — och det "dök upp" först en halv minut senare. Meddelandet
 * var sparat hela tiden; det var LÄSNINGEN som var gammal.
 *
 * Vi minns därför de rader vyn redan sett i minnet och slår ihop dem med
 * serverns första sida vid montering. ⛔ `router.refresh()` eller en delta-
 * hämtning hade lagt en Neon-läsning på VARJE samtalsöppning — det här kostar
 * ingenting. Kartan lever i fliken: en omladdning ger ändå färsk server-render.
 */
const REMEMBERED_MAX_CONVERSATIONS = 20;
const REMEMBERED_MAX_MESSAGES = 200;
const remembered = new Map<string, MessageDto[]>();

export function rememberMessages(conversationId: string, messages: MessageDto[]): void {
  remembered.delete(conversationId);
  remembered.set(conversationId, messages.slice(-REMEMBERED_MAX_MESSAGES));
  while (remembered.size > REMEMBERED_MAX_CONVERSATIONS) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

export function recallMessages(conversationId: string): MessageDto[] {
  return remembered.get(conversationId) ?? [];
}

/** sessionStorage-nyckeln UnreadBadge cachar under — vyn nollar den när något lästs. */
export const UNREAD_CACHE_KEY = "fo_chat_unread";
export const UNREAD_CACHE_TTL_MS = 60_000;

export function invalidateUnreadCache(): void {
  try {
    sessionStorage.removeItem(UNREAD_CACHE_KEY);
  } catch {
    // privat läge / blockerad lagring — cachen är bara en bekvämlighet
  }
}
