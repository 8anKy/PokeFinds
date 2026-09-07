"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { recallPostToggle, rememberPostToggle } from "@/lib/forum-client";
import { LISTING_STATUSES, type ListingStatusValue } from "@/lib/listing-rules";
import { LISTING_STATUS_KEYS } from "@/lib/community-labels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FieldError, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconBookmark, IconChevronDown, IconFlag, IconHeart } from "@/components/ui/icons";
import { ContactButton } from "./contact-button";
import { useForumViewer } from "./use-forum-viewer";

/**
 * Trådens åtgärdsrad: gilla/spara/rapportera, ta bort (ägare/moderator),
 * annonsstatus (ägaren) och kontaktknappen. Personligt tillstånd hämtas
 * klient-sida — sidan är ISR och får inte kalla auth().
 *
 * ⛔ GILLA/SPARA VÄXLAR PÅ TRYCKET, INTE PÅ SVARET: knappen väntade förr på
 * rundturen till servern (och på att Neon vaknade), så hjärtat fylldes en
 * sekund eller mer efter fingret. Serverns svar rättar bara efteråt, och
 * växlingen minns i fliken (`lib/forum-client.ts`) så att den överlever att man
 * går ut ur tråden och in igen — sidan är ISR (300 s) och `/api/community/me`
 * cachas 30 s i klienten. ⛔ Ingen extra läsning: växlingen läggs OVANPÅ det
 * cachade svaret i stället för att kasta det.
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

  // Vad fliken redan vet om just den här tråden vinner över ISR-HTML:ens siffra.
  const [liked, setLiked] = useState(() => recallPostToggle(postId).liked ?? false);
  const [likeCount, setLikeCount] = useState(
    () => recallPostToggle(postId).likeCount ?? initialLikeCount
  );
  const [saved, setSaved] = useState(() => recallPostToggle(postId).saved ?? false);
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
    // ⛔ SIFFRAN I ISR-HTML:EN ÄR UPP TILL 300 s GAMMAL (+30 s routercache): mätt
    // 2026-09-07 stod ett fyllt hjärta bredvid en NOLLA, för `liked` kom från den
    // färska /me-läsningen och `initialLikeCount` från den gamla sidan. Servern
    // skickar därför räknaren i samma svar. Har fliken redan växlat den här
    // tråden är dess egen siffra nyare — /me kan vara upp till 30 s cachad.
    const fresh = state.counts[postId];
    if (fresh && recallPostToggle(postId).liked === undefined) setLikeCount(fresh.likeCount);
  }, [ready, state.likedIds, state.savedIds, state.counts, postId]);

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
    const prevLiked = liked;
    const prevCount = likeCount;
    const next = !prevLiked;
    setLiked(next);
    setLikeCount(Math.max(0, prevCount + (next ? 1 : -1)));
    rememberPostToggle(postId, { liked: next });
    try {
      const res = await apiFetch<{ liked: boolean; likeCount: number }>(
        `/api/community/posts/${postId}/like`,
        { method: "POST" }
      );
      setLiked(res.liked);
      setLikeCount(res.likeCount);
      rememberPostToggle(postId, { liked: res.liked, likeCount: res.likeCount });
    } catch (e) {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      rememberPostToggle(postId, { liked: prevLiked, likeCount: prevCount });
      toast({
        title: t("likeFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function toggleSave() {
    if (!requireLogin()) return;
    const prevSaved = saved;
    const next = !prevSaved;
    setSaved(next);
    rememberPostToggle(postId, { saved: next });
    // Säg VART den tog vägen — knappen ensam pekade ingenstans. Direkt, av samma
    // skäl som knappen: en bekräftelse som kommer en sekund senare läses som fel.
    toast({
      title: next ? t("savedToast") : t("unsavedToast"),
      description: next ? t("savedToastBody") : undefined,
      variant: "success",
    });
    try {
      const res = await apiFetch<{ saved: boolean }>(`/api/community/posts/${postId}/save`, {
        method: "POST",
      });
      setSaved(res.saved);
      rememberPostToggle(postId, { saved: res.saved });
    } catch (e) {
      setSaved(prevSaved);
      rememberPostToggle(postId, { saved: prevSaved });
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

  // ⛔ EN RUTA FÖR ÄGAR-/MODERATORÅTGÄRDER (ägarbeslut 2026-09-07). Förut låg
  // "Kontakta säljaren" högerställd på en egen rad (`ml-auto` som wrappade),
  // annonsstatusen i en nästan tom ram och Ta bort ensam längst till höger — tre
  // rader som såg ut som tre olika gränssnitt. Nu: reaktionerna i en rad,
  // huvudåtgärden i full bredd, och allt som kräver behörighet i EN ram.
  const showListingControls = !!listingKind && (isOwner || (isModerator && status === "ACTIVE"));
  const showDanger = isOwner || isModerator;
  /** Ägarens statusväljare — den enda grenen med ett formulärfält i raden. */
  const ownerStatus = showListingControls && isOwner;

  return (
    <div className="space-y-3">
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
      </div>

      {/* Huvudåtgärden: på en annons är det här hela poängen med tråden.
          Komponenten renderar null för trådskaparen — då blir det ingen tom rad. */}
      <ContactButton
        authorId={authorId}
        postId={postId}
        marketplace={isMarketplace}
        callbackPath={callbackPath}
        className="w-full sm:w-auto"
      />

      {(showListingControls || showDanger) && (
        <div className="rounded-xl border border-surface-border p-3">
          {ownerStatus ? (
            <>
              {/* Etiketten på EGEN rad: inklistrad bredvid väljaren blev raden tre
                  olika höga saker bredvid varandra, med ett tomrum i mitten. */}
              <Label htmlFor="listingStatus" className="mb-1.5 text-xs text-ink-muted">
                {t("statusLabel")}
              </Label>
              <div className="flex items-center gap-2">
                {/* ⛔ SAMMA HÖJD ÄR HELA POÄNGEN: `Select` är h-10 och `Button size="sm"`
                    är h-8 — sida vid sida såg de ut som ett misstag (ägaren 2026-09-07).
                    Knappen är därför `md` här, aldrig `sm`. */}
                <div className="relative min-w-0 flex-1">
                  <Select
                    id="listingStatus"
                    value={status}
                    disabled={busy}
                    onChange={(e) => void changeStatus(e.target.value as ListingStatusValue)}
                    className="pr-9"
                  >
                    {LISTING_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(LISTING_STATUS_KEYS[s])}
                      </option>
                    ))}
                  </Select>
                  {/* `appearance-none` tar bort systemets pil — utan den här läses
                      väljaren som ett textfält. */}
                  <IconChevronDown
                    size={16}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint"
                  />
                </div>
                {showDanger && (
                  <Button
                    variant="danger"
                    size="md"
                    className="shrink-0"
                    onClick={() => setDeleteOpen(true)}
                  >
                    {isModerator && !isOwner ? t("deleteModerator") : t("delete")}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {showListingControls && (
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() => void changeStatus("CLOSED")}
                >
                  {t("closeListing")}
                </Button>
              )}
              {showDanger && (
                <Button
                  variant="danger"
                  size="md"
                  className="ml-auto"
                  onClick={() => setDeleteOpen(true)}
                >
                  {isModerator && !isOwner ? t("deleteModerator") : t("delete")}
                </Button>
              )}
            </div>
          )}
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
