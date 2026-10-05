"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { ListingStatusValue } from "@/lib/listing-rules";
import { Button } from "@/components/ui/button";
import { FieldError, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconCheck, IconFlag, IconTrash, IconUser, IconX } from "@/components/ui/icons";
import type { FeedItem } from "@/services/community";
import { useForumViewer } from "./use-forum-viewer";

/**
 * "···"-menyn på ett inlägg i flödet (ägarbeslut 2026-10-05): en LISTA med det man
 * faktiskt kan göra, inte trådsidans knapprad. Gilla/spara/rösta finns redan i
 * kortet. Eget inlägg = ta bort (+ annonsstatus på en annons); någon annans =
 * anmäl + visa profil; moderator = även ta bort. Bekräftelse och anmälan sker i
 * SAMMA ark — aldrig en modal ovanpå ett ark.
 */
export function PostOptionsMenu({ post, onClose, onDeleted }: {
  post: FeedItem;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("Forum");
  const tMenu = useTranslations("LocalStores");
  const router = useRouter();
  const { toast } = useToast();
  const { loggedIn, viewer, isModerator } = useForumViewer([post.id]);
  const [view, setView] = useState<"menu" | "delete" | "report">("menu");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ListingStatusValue>(post.listingStatus ?? "ACTIVE");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isOwner = viewer?.id === post.user.id;
  const canDelete = isOwner || isModerator;

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/api/community/posts/${post.id}`, { method: "DELETE" });
      toast({ title: t("deleted"), variant: "success" });
      onDeleted();
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
      setBusy(false);
    }
  }
  async function report() {
    if (reason.trim().length < 3) { setError(t("reportTooShort")); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/community/posts/${post.id}/report`, { method: "POST", body: { reason: reason.trim() } });
      toast({ title: t("reportThanks"), description: t("reportThanksBody"), variant: "success" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
      setBusy(false);
    }
  }
  async function changeStatus(next: ListingStatusValue) {
    setBusy(true);
    try {
      await apiFetch(`/api/community/posts/${post.id}`, { method: "PATCH", body: { listingStatus: next } });
      setStatus(next);
      toast({ title: t("statusUpdated"), variant: "success" });
      onClose();
      router.refresh();
    } catch (e) {
      toast({ title: t("statusFailed"), description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  if (view === "delete") return <div className="space-y-4 pb-2">
    <div>
      <p className="font-semibold text-ink">{tMenu("optDeleteTitle")}</p>
      <p className="mt-1 text-sm text-ink-muted">{tMenu(post.storeReport ? "optDeleteBodyReport" : "optDeleteBody")}</p>
    </div>
    <FieldError message={error} />
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" size="lg" onClick={() => { setView("menu"); setError(null); }} disabled={busy}>{t("cancel")}</Button>
      <Button variant="danger" size="lg" onClick={() => void remove()} loading={busy}>{t("delete")}</Button>
    </div>
  </div>;

  if (view === "report") return <div className="space-y-3 pb-2">
    <p className="font-semibold text-ink">{t("reportLabel")}</p>
    <Textarea placeholder={t("reportPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus />
    <FieldError message={error} />
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" size="lg" onClick={() => { setView("menu"); setError(null); }} disabled={busy}>{t("cancel")}</Button>
      <Button variant="danger" size="lg" onClick={() => void report()} loading={busy}>{t("reportSend")}</Button>
    </div>
  </div>;

  const rows: ReactNode[] = [];
  const row = (key: string, icon: ReactNode, label: string, onClick: () => void, danger = false) => rows.push(
    <button key={key} type="button" disabled={busy} onClick={onClick}
      className={cn("flex min-h-14 w-full items-center gap-3 text-left text-[15px] font-medium transition-colors active:bg-surface-overlay/50", danger ? "text-fall" : "text-ink")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-overlay">{icon}</span>{label}
    </button>
  );
  if (isOwner && post.listingKind) {
    if (status !== "SOLD") row("sold", <IconCheck size={18} />, tMenu("optMarkSold"), () => void changeStatus("SOLD"));
    if (status !== "CLOSED") row("closed", <IconX size={18} />, tMenu("optMarkClosed"), () => void changeStatus("CLOSED"));
    if (status !== "ACTIVE") row("active", <IconCheck size={18} />, tMenu("optMarkActive"), () => void changeStatus("ACTIVE"));
  }
  if (!isOwner && isModerator && post.listingKind && status === "ACTIVE") {
    row("mod-close", <IconX size={18} />, t("closeListing"), () => void changeStatus("CLOSED"));
  }
  if (loggedIn && !isOwner) row("report", <IconFlag size={18} />, tMenu("optReport"), () => setView("report"));
  if (canDelete) row("delete", <IconTrash size={18} />, isOwner ? tMenu("optDeletePost") : t("deleteModerator"), () => setView("delete"), true);

  return <div className="pb-2">
    {!isOwner && (
      <Link href={`/profil/${post.user.id}`} onClick={onClose} className="flex min-h-14 w-full items-center gap-3 text-[15px] font-medium text-ink active:bg-surface-overlay/50">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-overlay"><IconUser size={18} /></span>
        <span className="min-w-0 truncate">{tMenu("optViewProfile")}<span className="ml-2 font-normal text-ink-muted">{post.user.name}</span></span>
      </Link>
    )}
    {rows}
    {!loggedIn && <p className="pt-2 text-sm text-ink-muted">{tMenu("optLoginHint")}</p>}
  </div>;
}
