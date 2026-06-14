"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { IconBell } from "@/components/ui/icons";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export function NotificationsBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NotificationsResponse>("/api/notifications?pageSize=10");
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // tyst – klockan ska inte störa
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markAllRead() {
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST" });
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast({ title: "Alla notiser markerade som lästa", variant: "success" });
    } catch (e) {
      toast({
        title: "Kunde inte markera som lästa",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={
          unreadCount > 0 ? `Notiser, ${unreadCount} olästa` : "Notiser"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-surface-border bg-surface-raised text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan"
      >
        <IconBell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-holo-cyan px-1 text-xs font-bold text-surface">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 animate-fade-in rounded-xl border border-surface-border bg-surface-overlay shadow-card">
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notiser</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-medium text-holo-cyan transition-colors hover:underline"
              >
                Markera alla som lästa
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">
                Inga notiser ännu. Vi säger till när något händer på din bevakningslista.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {items.map((n) => {
                  const content = (
                    <>
                      <div className="flex items-start gap-2">
                        {!n.isRead && (
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-holo-cyan"
                            aria-label="Oläst"
                          />
                        )}
                        <div className="min-w-0">
                          <p className={cn("text-sm", n.isRead ? "text-ink-muted" : "font-semibold text-ink")}>
                            {n.title}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>
                          <p className="mt-1 text-xs text-ink-faint">{formatRelative(n.createdAt)}</p>
                        </div>
                      </div>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {n.linkUrl ? (
                        <Link
                          href={n.linkUrl}
                          onClick={() => setOpen(false)}
                          className="block px-4 py-3 transition-colors hover:bg-surface-raised"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className="px-4 py-3">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
