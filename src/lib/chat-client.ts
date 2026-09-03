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
