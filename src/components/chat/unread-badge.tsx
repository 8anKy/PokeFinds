"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { hasAuthHint } from "@/lib/auth-hint";
import { UNREAD_CACHE_KEY, UNREAD_CACHE_TTL_MS } from "@/lib/chat-client";

/**
 * Kontrakt 2: liten turkos bubbla med antal samtal som har olästa meddelanden.
 * Renderar ingenting och gör INGEN förfrågan om `fo_auth`-cookien inte är 1.
 * Läser dessutom `fo_beta`: den som inte ser funktionen skulle bara få ett 404
 * ur /api/chat/unread — och en Neon-väckning för ingenting. Hämtar EN gång
 * per montering, cachar `{count, at}` i sessionStorage i 60 s.
 */
export function UnreadBadge() {
  const t = useTranslations("Chat");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!hasAuthHint()) return;
    if (!document.cookie.split("; ").includes("fo_beta=1")) return;

    try {
      const raw = sessionStorage.getItem(UNREAD_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { count?: number; at?: number };
        if (
          typeof cached.count === "number" &&
          typeof cached.at === "number" &&
          Date.now() - cached.at < UNREAD_CACHE_TTL_MS
        ) {
          setCount(cached.count);
          return;
        }
      }
    } catch {
      // trasig/blockerad lagring → hämta
    }

    let cancelled = false;
    fetch("/api/chat/unread", { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<{ count?: number }>) : null))
      .then((data) => {
        if (cancelled || !data || typeof data.count !== "number") return;
        setCount(data.count);
        try {
          sessionStorage.setItem(
            UNREAD_CACHE_KEY,
            JSON.stringify({ count: data.count, at: Date.now() })
          );
        } catch {
          // ingen cache är ofarligt
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (count <= 0) return null;
  return (
    <span
      aria-label={t("unreadCount", { count })}
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-holo-cyan px-1 text-[10px] font-bold leading-none text-surface tabular-nums"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
