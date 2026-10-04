"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { rememberPostToggle, recallPostToggle } from "@/lib/forum-client";
import { reportIsFresh } from "@/lib/community-stores";
import { voteLabelKey, type StoreReportVote } from "@/lib/store-report-votes";
import { cn } from "@/lib/utils";
import { IconHeart, IconBookmark, IconMessage, IconShare, IconCheck, IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { FeedItem } from "@/services/community";
import type { useForumViewer } from "./use-forum-viewer";

export function FeedActions({ post, personal, href, onComments, commentCount }: {
  post: FeedItem;
  personal: ReturnType<typeof useForumViewer>;
  href: string;
  onComments: () => void;
  commentCount?: number;
}) {
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
  const [vote, setVote] = useState<StoreReportVote | null>(null);
  const [tally, setTally] = useState({ confirmCount: report?.confirmCount ?? 0, disputeCount: report?.disputeCount ?? 0 });
  // Rösta = "stämmer fortfarande"/"inte längre": bara andras rapporter och bara medan de
  // är färska (servern dömer likadant). Klockan läses efter mount så SSR och klient är lika.
  const [fresh, setFresh] = useState(false);
  useEffect(() => { if (report) setFresh(reportIsFresh(report.observedAt)); }, [report]);
  useEffect(() => { setVote(personal.state.reportVotes[post.id] ?? null); }, [personal.state, post.id]);
  useEffect(() => {
    const local = recallPostToggle(post.id);
    setLiked(local.liked ?? personal.state.likedIds.includes(post.id));
    setSaved(local.saved ?? personal.state.savedIds.includes(post.id));
    setCount(local.likeCount ?? personal.state.counts[post.id]?.likeCount ?? post.likeCount);
  }, [personal.state, post.id, post.likeCount]);
  const ownReport = !!report && personal.viewer?.id === post.user.id;
  const canVote = !!report && fresh && !ownReport;

  function requireLogin(): boolean {
    if (personal.loggedIn) return false;
    router.push(`/logga-in?callbackUrl=${encodeURIComponent(href)}`);
    return true;
  }
  async function toggle(kind: "like" | "save") {
    if (busy || requireLogin()) return;
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
  async function castVote(kind: StoreReportVote) {
    if (busy || requireLogin()) return;
    setBusy(true); setError("");
    const previous = { vote, tally };
    // Optimistiskt: samma knapp igen tar bort rösten, den andra byter den.
    const next = vote === kind ? null : kind;
    const delta = (k: StoreReportVote) => (next === k ? 1 : 0) - (vote === k ? 1 : 0);
    setVote(next);
    setTally({ confirmCount: Math.max(0, tally.confirmCount + delta("CONFIRM")), disputeCount: Math.max(0, tally.disputeCount + delta("DISPUTE")) });
    try {
      const data = await apiFetch<{ vote: StoreReportVote | null; confirmCount: number; disputeCount: number }>(
        `/api/community/posts/${post.id}/confirm`, { method: "POST", body: JSON.stringify({ kind }) });
      setVote(data.vote);
      setTally({ confirmCount: data.confirmCount, disputeCount: data.disputeCount });
      if (data.vote) toast({ title: tStores("voteThanks"), variant: "success" });
    } catch (e) {
      setVote(previous.vote); setTally(previous.tally);
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

  if (report) {
    // Butiksrapport (ägarbeslut 2026-10-05): åtgärderna LAST i kortet, ingen dela/spara,
    // rösterna "stämmer fortfarande"/"inte längre" i stället.
    const comments = commentCount ?? personal.state.counts[post.id]?.commentCount ?? post.commentCount;
    const voteButton = (kind: StoreReportVote) => {
      const n = kind === "CONFIRM" ? tally.confirmCount : tally.disputeCount;
      const active = vote === kind;
      const Icon = kind === "CONFIRM" ? IconCheck : IconX;
      return (
        <button type="button" disabled={busy || !canVote} aria-pressed={active} onClick={() => void castVote(kind)}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors disabled:cursor-default",
            active
              ? kind === "CONFIRM" ? "border-rise bg-rise/15 text-rise" : "border-fall bg-fall/15 text-fall"
              : "border-surface-border text-ink",
            !canVote && !active && "text-ink-muted"
          )}>
          <Icon size={16} aria-hidden="true" />
          <span className="truncate">{tStores(voteLabelKey(report.observation, kind))}</span>
          {n > 0 && <span className="tabular-nums opacity-80">{n}</span>}
        </button>
      );
    };
    const hasVotes = tally.confirmCount + tally.disputeCount > 0;
    return <div className="space-y-2">
      {(canVote || hasVotes) && <div>
        {canVote && <p className="mb-1.5 text-xs font-medium text-ink-muted">{tStores(report.observation === "SOLD_OUT" ? "voteQuestionSoldOut" : "voteQuestion")}</p>}
        <div className="grid grid-cols-2 gap-2">{voteButton("CONFIRM")}{voteButton("DISPUTE")}</div>
      </div>}
      <div className="flex items-center gap-1 text-ink">
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 pr-3" disabled={busy} aria-pressed={liked} aria-label={t("likes")} onClick={() => void toggle("like")}>
          <IconHeart size={23} className={liked ? "fill-holo-cyan text-holo-cyan" : ""} />
          {count > 0 && <span className="text-sm font-semibold tabular-nums">{count}</span>}
        </button>
        <button type="button" onClick={onComments} className="inline-flex min-h-11 items-center gap-1.5 pr-3" aria-label={tStores("comments")}>
          <IconMessage size={23} />
          {comments > 0 && <span className="text-sm font-semibold tabular-nums">{comments}</span>}
        </button>
      </div>
      {error && <p className="text-xs text-fall" role="alert">{error}</p>}
    </div>;
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
