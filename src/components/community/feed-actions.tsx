"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { rememberPostToggle, recallPostToggle } from "@/lib/forum-client";
import { IconHeart, IconBookmark, IconMessage } from "@/components/ui/icons";
import type { FeedItem } from "@/services/community";
import type { useForumViewer } from "./use-forum-viewer";

export function FeedActions({ post, personal, href }: { post: FeedItem; personal: ReturnType<typeof useForumViewer>; href: string }) {
  const t = useTranslations("Forum");
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
  return <div className="border-t border-surface-border px-4 py-2">
    <div className="flex items-center gap-4 text-sm text-ink-muted">
      <button type="button" className="inline-flex min-h-11 items-center gap-1.5" disabled={busy} aria-pressed={liked} aria-label={t("likes")} onClick={() => void toggle("like")}><IconHeart size={19} className={liked ? "text-holo-cyan" : ""} />{count}</button>
      <Link href={href} className="inline-flex min-h-11 items-center gap-1.5"><IconMessage size={19} />{personal.state.counts[post.id]?.commentCount ?? post.commentCount}<span className="sr-only">{t("replies")}</span></Link>
      <button type="button" className="ml-auto inline-flex min-h-11 items-center" disabled={busy} aria-pressed={saved} aria-label={t("savedLink")} onClick={() => void toggle("save")}><IconBookmark size={19} className={saved ? "text-holo-cyan" : ""} /></button>
    </div>
    {error && <p className="text-xs text-fall" role="alert">{error}</p>}
  </div>;
}
