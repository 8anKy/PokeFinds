"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { rememberPostToggle, recallPostToggle } from "@/lib/forum-client";
import { IconHeart, IconBookmark, IconMessage, IconShare } from "@/components/ui/icons";
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
      <button type="button" className="grid h-11 w-11 place-items-center" aria-label={tStores("sharePost")} onClick={() => void share()}><IconShare size={23} /></button>
      <button type="button" className="ml-auto grid h-11 w-11 place-items-center" disabled={busy} aria-pressed={saved} aria-label={t("savedLink")} onClick={() => void toggle("save")}><IconBookmark size={25} className={saved ? "fill-holo-cyan text-holo-cyan" : ""} /></button>
    </div>
    {count > 0 && <p className="pb-1 text-sm font-semibold text-ink">{count} {t("likes")}</p>}
    {error && <p className="text-xs text-fall" role="alert">{error}</p>}
  </div>;
}
