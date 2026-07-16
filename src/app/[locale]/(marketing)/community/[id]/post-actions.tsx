"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button, LinkButton } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea, Label, FieldError } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { IconBookmark, IconFlag, IconHeart } from "@/components/ui/icons";

export interface CommentRow {
  id: string;
  content: string;
  createdAt: string; // ISO
  user: { id: string; name: string; reputationScore: number };
}

export interface Viewer {
  id: string;
  isModerator: boolean;
}

export function PostActions({
  postId,
  initialLiked,
  initialLikeCount,
  initialSaved,
  initialComments,
  isOwner,
  viewer,
}: {
  postId: string;
  initialLiked: boolean;
  initialLikeCount: number;
  initialSaved: boolean;
  initialComments: CommentRow[];
  isOwner: boolean;
  viewer: Viewer | null;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [saved, setSaved] = useState(initialSaved);
  const [comments, setComments] = useState(initialComments);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const loggedIn = viewer != null;

  async function toggleLike() {
    if (!loggedIn) {
      router.push(`/logga-in?callbackUrl=/community/${postId}`);
      return;
    }
    try {
      const res = await apiFetch<{ liked: boolean; likeCount: number }>(
        `/api/community/posts/${postId}/like`,
        { method: "POST" }
      );
      setLiked(res.liked);
      setLikeCount(res.likeCount);
    } catch (e) {
      toast({
        title: "Det gick inte att gilla inlägget",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function toggleSave() {
    if (!loggedIn) {
      router.push(`/logga-in?callbackUrl=/community/${postId}`);
      return;
    }
    try {
      const res = await apiFetch<{ saved: boolean }>(`/api/community/posts/${postId}/save`, {
        method: "POST",
      });
      setSaved(res.saved);
      toast({
        title: res.saved ? "Inlägget har sparats" : "Inlägget har tagits bort från sparade",
        variant: "success",
      });
    } catch (e) {
      toast({
        title: "Det gick inte att spara inlägget",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function submitReport() {
    if (reportReason.trim().length < 3) {
      setReportError("Beskriv kort varför du rapporterar inlägget.");
      return;
    }
    setBusy(true);
    setReportError(null);
    try {
      await apiFetch(`/api/community/posts/${postId}/report`, {
        method: "POST",
        body: { reason: reportReason.trim() },
      });
      toast({
        title: "Tack för din rapport",
        description: "Moderatorerna tittar på det så snart som möjligt.",
        variant: "success",
      });
      setReportOpen(false);
      setReportReason("");
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!loggedIn) {
      router.push(`/logga-in?callbackUrl=/community/${postId}`);
      return;
    }
    if (!commentText.trim()) {
      setCommentError("Kommentaren får inte vara tom.");
      return;
    }
    setBusy(true);
    setCommentError(null);
    try {
      const comment = await apiFetch<CommentRow>(`/api/community/posts/${postId}/comments`, {
        method: "POST",
        body: { content: commentText.trim() },
      });
      setComments((prev) => [...prev, comment]);
      setCommentText("");
      toast({ title: "Kommentar publicerad", variant: "success" });
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePost() {
    setBusy(true);
    try {
      await apiFetch(`/api/community/posts/${postId}`, { method: "DELETE" });
      toast({ title: "Inlägget har tagits bort", variant: "success" });
      router.push("/community");
      router.refresh();
    } catch (e) {
      toast({
        title: "Det gick inte att ta bort inlägget",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Åtgärdsrad */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={liked ? "primary" : "secondary"}
          size="sm"
          onClick={() => void toggleLike()}
          aria-pressed={liked}
        >
          <IconHeart size={16} fill={liked ? "currentColor" : "none"} />
          <span className="tabular-nums">{likeCount}</span>
          <span className="sr-only">gilla-markeringar</span>
        </Button>
        <Button
          variant={saved ? "outline" : "secondary"}
          size="sm"
          onClick={() => void toggleSave()}
          aria-pressed={saved}
        >
          <IconBookmark size={16} fill={saved ? "currentColor" : "none"} />
          {saved ? "Sparad" : "Spara"}
        </Button>
        {loggedIn && (
          <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}>
            <IconFlag size={16} />
            Rapportera
          </Button>
        )}
        {(isOwner || viewer?.isModerator) && (
          <Button variant="danger" size="sm" className="ml-auto" onClick={() => setDeleteOpen(true)}>
            {viewer?.isModerator && !isOwner ? "Ta bort (moderator)" : "Ta bort inlägg"}
          </Button>
        )}
      </div>

      {/* Kommentarer */}
      <section aria-label="Kommentarer">
        <h2 className="font-display text-lg font-semibold text-ink">
          Kommentarer ({comments.length})
        </h2>
        <div className="mt-4 space-y-4">
          {comments.length === 0 && (
            <p className="text-sm text-ink-muted">Inga kommentarer ännu. Bli först!</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-surface-border bg-surface-raised p-4">
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <span className="font-medium text-ink">{c.user.name}</span>
                {c.user.reputationScore > 100 && <Badge variant="holo">Veteran</Badge>}
                <span>·</span>
                <span>{formatRelative(c.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{c.content}</p>
            </div>
          ))}
        </div>

        {/* Kommentarsformulär */}
        {loggedIn ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitComment();
            }}
          >
            <Label htmlFor="newComment">Skriv en kommentar</Label>
            <Textarea
              id="newComment"
              placeholder="Var schysst, vi är alla här för korten."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              maxLength={5000}
            />
            <FieldError message={commentError} />
            <Button type="submit" loading={busy}>
              Kommentera
            </Button>
          </form>
        ) : (
          <div className="mt-6">
            <LinkButton href={`/logga-in?callbackUrl=/community/${postId}`} variant="outline">
              Logga in för att kommentera
            </LinkButton>
          </div>
        )}
      </section>

      {/* Rapportera */}
      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Rapportera inlägg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={() => void submitReport()} loading={busy}>
              Skicka rapport
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Label htmlFor="reportReason">Varför rapporterar du inlägget?</Label>
          <Textarea
            id="reportReason"
            placeholder="t.ex. spam, bedrägeri, olämpligt innehåll…"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            maxLength={1000}
          />
          <FieldError message={reportError} />
        </div>
      </Modal>

      {/* Ta bort */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Ta bort inlägg?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={() => void deletePost()} loading={busy}>
              Ta bort
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Inlägget och alla dess kommentarer tas bort permanent. Detta går inte att ångra.
        </p>
      </Modal>
    </div>
  );
}
