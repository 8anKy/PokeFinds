"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/client-api";
import { useEventCallback } from "@/hooks/use-event-callback";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import type { CommentDto } from "@/services/community";
import { Replies } from "./replies";

export function CommentsSheet({ postId, onClose, onCountChange }: { postId: string; onClose: () => void; onCountChange: (count: number) => void }) {
  const t = useTranslations("LocalStores");
  const [items, setItems] = useState<CommentDto[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const closedByHistory = useRef(false);
  const active = useRef(false);
  const close = useEventCallback(onClose);
  useEffect(() => {
    active.current = true;
    const openedUrl = window.location.href;
    const trigger = document.activeElement as HTMLElement | null;
    // ⛔ Bakåt stänger arket utan att lämna flödet. Nexts historiktillstånd
    // bevaras; en egen tom state hade förstört klientrouterns återgång.
    if (window.history.state?.foilioComments !== postId) window.history.pushState({ ...window.history.state, foilioComments: postId }, "", window.location.href);
    const onPop = () => { closedByHistory.current = true; close(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      active.current = false;
      // StrictMode monterar om effekten direkt. Flytta bara historiken när
      // arket verkligen lämnat trädet, annars stängs det redan när det öppnas.
      queueMicrotask(() => { if (!active.current && !closedByHistory.current && window.location.href === openedUrl && window.history.state?.foilioComments === postId) window.history.back(); });
      if (window.location.href === openedUrl && trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
    };
  }, [postId, close]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    apiFetch<{ items: CommentDto[] }>(`/api/community/posts/${postId}/comments`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setItems(data.items); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("error")); });
    return () => controller.abort();
  }, [postId, attempt, t]);
  return <BottomSheet open title={t("comments")} closeLabel={t("close")} onClose={close} headerAction={{ label: t("close"), onClick: close }}
    panelClassName="h-[78dvh] sm:mx-auto sm:w-full sm:max-w-xl" footer={<div ref={setFooter} />}>
    {error ? <div className="space-y-3 py-5"><p role="alert" className="text-sm text-fall">{error}</p><Button variant="ghost" onClick={() => setAttempt(n => n + 1)}>{t("retry")}</Button></div> : items ? <Replies postId={postId} initial={items} compact footerTarget={footer} onCountChange={onCountChange} /> : <p role="status" className="py-8 text-center text-sm text-ink-muted">{t("loading")}</p>}
  </BottomSheet>;
}
