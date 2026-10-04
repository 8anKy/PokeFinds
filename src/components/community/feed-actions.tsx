"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { rememberPostToggle, recallPostToggle } from "@/lib/forum-client";
import { IconHeart, IconBookmark, IconMessage, IconShare, IconCheck } from "@/components/ui/icons";
import { reportIsFresh } from "@/lib/community-stores";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { FeedItem } from "@/services/community";
import type { useForumViewer } from "./use-forum-viewer";

export function FeedActions({ post, personal, href, onComments }: { post: FeedItem; personal: ReturnType<typeof useForumViewer>; href: string; onComments: () => void }) {
  const t = useTranslations("Forum");
  const tStores = useTranslations("LocalStores");
  const { toast } = useToast();
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [count, setCount] = useState(post.likeCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const report = post.storeReport ?? null;
  const [confirmed, setConfirmed] = useState(false);
  const [confirmCount, setConfirmCount] = useState(report?.confirmCount ?? 0);
  // Bekräfta = "jag ser den också": bara andras rapporter och bara medan de är färska
  // (servern dömer likadant). Klockan läses efter mount så SSR och klient är lika.
  const [fresh, setFresh] = useState(false);
  useEffect(() => { if (report) setFresh(reportIsFresh(report.observedAt)); }, [report]);
  useEffect(() => { setConfirmed(personal.state.confirmedIds.includes(post.id)); }, [personal.state, post.id]);
  const ownReport = !!report && personal.viewer?.id === post.user.id;
  async function toggleConfirm() {
    if (busy) return;
    if (!personal.loggedIn) { router.push(`/logga-in?callbackUrl=${encodeURIComponent(href)}`); return; }
    setBusy(true); setError("");
    const previous = confirmed;
    const previousCount = confirmCount;
    setConfirmed(!previous); setConfirmCount(Math.max(0, confirmCount + (previous ? -1 : 1)));
    try {
      const data = await apiFetch<{ confirmed: boolean; confirmCount: number }>(`/api/community/posts/${post.id}/confirm`, { method: "POST" });
      setConfirmed(data.confirmed); setConfirmCount(data.confirmCount);
      if (data.confirmed) toast({ title: tStores("confirmThanks"), variant: "success" });
    } catch (e) {
      setConfirmed(previous); setConfirmCount(previousCount);
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const local = recallPostToggle(post.id);
    setLiked(local.liked ?? personal.state.likedIds.includes(post.id));
    setSaved(local.saved ?? personal.state.savedIds.includes(post.id));
    setCount(local.likeCount ?? personal.state.counts[post.id]?.likeCount ?? post.likeCount);
  }, [personal.state, post.id, post.likeCount]);
  async function toggle(kind: "like" | "save") {
    if (busy) return;
    if (!personal.loggedIn) { router.push(`/logga-in?callbackUrl=${encodeURIComponent(href)}`); return; }
    setBusy(true); setError("");
    const previous = kind === "like" ? liked : saved;
    const previousCount = count;
    if (kind === "like") { setLiked(!previous); setCount(Math.max(0, count + (previous ? -1 : 1))); }
    else setSaved(!previous);
    try {
      const data = await apiFetch<{ liked: boolean; saved: boolean; likeCount: number }>(`/api/community/posts/${post.id}/${kind}`, { method: "POST" });
      if (kind === "like") { setLiked(data.liked); setCount(data.likeCount); rememberPostToggle(post.id, { liked: data.liked, likeCount: data.likeCount }); }
      else { setSaved(data.saved); rememberPostToggle(post.id, { saved: data.saved }); }
    } catch (e) {
      if (kind === "like") { setLiked(previous); setCount(previousCount); } else setSaved(previous);
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    } finally { setBusy(false); }
  }
  async function share() {
    const url = new URL(href, window.location.href);
    // Behåll språkprefixet även när standardlokalen inte syns i adressen.
    const prefix = window.location.pathname.match(/^\/(sv|en)(?:\/|$)/)?.[1];
    if (prefix) url.pathname = `/${prefix}${href}`;
    try {
      if (navigator.share) await navigator.share({ title: post.title, url: url.href });
      else { await navigator.clipboard.writeText(url.href); toast({ title: tStores("linkCopied"), variant: "success" }); }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(tStores("shareError")); }
  }
  return <div className="px-2.5 pb-1 sm:px-0">
    <div className="flex items-center gap-2 text-ink">
      <button type="button" className="grid h-11 w-11 place-items-center" disabled={busy} aria-pressed={liked} aria-label={t("likes")} onClick={() => void toggle("like")}><IconHeart size={25} className={liked ? "fill-holo-cyan text-holo-cyan" : ""} /></button>
      <button type="button" onClick={onComments} className="grid h-11 w-11 place-items-center" aria-label={tStores("comments")}><IconMessage size={25} /></button>
      {report ? (
        // Butiksrapporter: ingen dela/spara (ägarbeslut 2026-10-05) — bekräfta i stället.
        fresh && !ownReport && <button type="button" disabled={busy} aria-pressed={confirmed} aria-label={tStores("confirmHint")} onClick={() => void toggleConfirm()}
          className={cn("ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
            confirmed ? "border-holo-cyan bg-holo-cyan text-black" : "border-surface-border text-ink")}>
          <IconCheck size={16} />{confirmed ? tStores("confirmed") : tStores("confirm")}
        </button>
      ) : <>
        <button type="button" className="grid h-11 w-11 place-items-center" aria-label={tStores("sharePost")} onClick={() => void share()}><IconShare size={23} /></button>
        <button type="button" className="ml-auto grid h-11 w-11 place-items-center" disabled={busy} aria-pressed={saved} aria-label={t("savedLink")} onClick={() => void toggle("save")}><IconBookmark size={25} className={saved ? "fill-holo-cyan text-holo-cyan" : ""} /></button>
      </>}
    </div>
    {(count > 0 || confirmCount > 0) && <p className="pb-1 text-sm font-semibold text-ink">
      {count > 0 && <span>{count} {t("likes")}</span>}
      {count > 0 && confirmCount > 0 && <span className="text-ink-muted"> · </span>}
      {confirmCount > 0 && <span className="text-holo-cyan">{tStores("confirmCount", { count: confirmCount })}</span>}
    </p>}
    {error && <p className="text-xs text-fall" role="alert">{error}</p>}
  </div>;
}
