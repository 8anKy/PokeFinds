"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { LISTING_STATUSES, type ListingStatusValue } from "@/lib/listing-rules";
import { LISTING_STATUS_KEYS } from "@/lib/community-labels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FieldError, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconBookmark, IconFlag, IconHeart } from "@/components/ui/icons";
import { ContactButton } from "./contact-button";
import { invalidatePersonalState, useForumViewer } from "./use-forum-viewer";

/**
 * Trådens åtgärdsrad: gilla/spara/rapportera, ta bort (ägare/moderator),
 * annonsstatus (ägaren) och kontaktknappen. Personligt tillstånd hämtas
 * klient-sida — sidan är ISR och får inte kalla auth().
 */
export function ThreadActions({
  postId,
  authorId,
  initialLikeCount,
  listingKind,
  listingStatus,
  isMarketplace,
}: {
  postId: string;
  authorId: string;
  initialLikeCount: number;
  listingKind: string | null;
  listingStatus: ListingStatusValue | null;
  isMarketplace: boolean;
}) {
  const t = useTranslations("Forum");
  const router = useRouter();
  const { toast } = useToast();
  const { loggedIn, viewer, state, ready, isModerator } = useForumViewer([postId]);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<ListingStatusValue>(listingStatus ?? "ACTIVE");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    setLiked(state.likedIds.includes(postId));
    setSaved(state.savedIds.includes(postId));
  }, [ready, state.likedIds, state.savedIds, postId]);

  const isOwner = viewer?.id === authorId;
  const callbackPath = `/forum/t/${postId}`;
  const loginHref = `/logga-in?callbackUrl=${encodeURIComponent(callbackPath)}`;

  function requireLogin(): boolean {
    if (loggedIn) return true;
    router.push(loginHref);
    return false;
  }

  async function toggleLike() {
    if (!requireLogin()) return;
    try {
      const res = await apiFetch<{ liked: boolean; likeCount: number }>(
        `/api/community/posts/${postId}/like`,
        { method: "POST" }
      );
      setLiked(res.liked);
      setLikeCount(res.likeCount);
      invalidatePersonalState();
    } catch (e) {
      toast({
        title: t("likeFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function toggleSave() {
    if (!requireLogin()) return;
    try {
      const res = await apiFetch<{ saved: boolean }>(`/api/community/posts/${postId}/save`, {
        method: "POST",
      });
      setSaved(res.saved);
      invalidatePersonalState();
      toast({ title: res.saved ? t("savedToast") : t("unsavedToast"), variant: "success" });
    } catch (e) {
      toast({
        title: t("saveFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function submitReport() {
    if (reportReason.trim().length < 3) {
      setReportError(t("reportTooShort"));
      return;
    }
    setBusy(true);
    setReportError(null);
    try {
      await apiFetch(`/api/community/posts/${postId}/report`, {
        method: "POST",
        body: { reason: reportReason.trim() },
      });
      toast({ title: t("reportThanks"), description: t("reportThanksBody"), variant: "success" });
      setReportOpen(false);
      setReportReason("");
    } catch (e) {
      setReportError(e instanceof Error ? e.message : t("somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: ListingStatusValue) {
    const prev = status;
    setStatus(next);
    setBusy(true);
    try {
      await apiFetch(`/api/community/posts/${postId}`, {
        method: "PATCH",
        body: { listingStatus: next },
      });
      toast({ title: t("statusUpdated"), variant: "success" });
      // Annonsrutan ligger i ISR-HTML:en och är just revaliderad på servern.
      router.refresh();
    } catch (e) {
      setStatus(prev);
      toast({
        title: t("statusFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function deletePost() {
    setBusy(true);
    try {
      await apiFetch(`/api/community/posts/${postId}`, { method: "DELETE" });
      toast({ title: t("deleted"), variant: "success" });
      router.push("/forum");
      router.refresh();
    } catch (e) {
      toast({
        title: t("deleteFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={liked ? "primary" : "secondary"}
          size="sm"
          onClick={() => void toggleLike()}
          aria-pressed={liked}
        >
          <IconHeart size={16} fill={liked ? "currentColor" : "none"} />
          <span className="tabular-nums">{likeCount}</span>
          <span className="sr-only">{t("likes")}</span>
        </Button>
        <Button
          variant={saved ? "outline" : "secondary"}
          size="sm"
          onClick={() => void toggleSave()}
          aria-pressed={saved}
        >
          <IconBookmark size={16} fill={saved ? "currentColor" : "none"} />
          {saved ? t("saved") : t("save")}
        </Button>
        {loggedIn && !isOwner && (
          <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}>
            <IconFlag size={16} />
            {t("report")}
          </Button>
        )}
        <span className="ml-auto">
          <ContactButton
            authorId={authorId}
            postId={postId}
            marketplace={isMarketplace}
            callbackPath={callbackPath}
          />
        </span>
      </div>

      {listingKind && (isOwner || (isModerator && status === "ACTIVE")) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border p-3">
          {isOwner ? (
            <>
              <Label htmlFor="listingStatus" className="mb-0">
                {t("statusLabel")}
              </Label>
              <Select
                id="listingStatus"
                value={status}
                disabled={busy}
                onChange={(e) => void changeStatus(e.target.value as ListingStatusValue)}
                className="w-auto min-w-[10rem]"
              >
                {LISTING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(LISTING_STATUS_KEYS[s])}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => void changeStatus("CLOSED")}
            >
              {t("closeListing")}
            </Button>
          )}
        </div>
      )}

      {(isOwner || isModerator) && (
        <div className="flex justify-end">
          <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
            {isModerator && !isOwner ? t("deleteModerator") : t("delete")}
          </Button>
        </div>
      )}

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t("reportTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void submitReport()} loading={busy}>
              {t("reportSend")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Label htmlFor="reportReason">{t("reportLabel")}</Label>
          <Textarea
            id="reportReason"
            placeholder={t("reportPlaceholder")}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            maxLength={1000}
          />
          <FieldError message={reportError} />
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("deleteTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void deletePost()} loading={busy}>
              {t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">{t("deleteBody")}</p>
      </Modal>
    </div>
  );
}
