"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { IconExternalLink, IconFlag, IconLock } from "@/components/ui/icons";
import { BackCircle, CIRCLE_CLASS } from "@/components/ui/back-circle";
import { REPORT_REASON_MAX, REPORT_REASON_MIN, threadPath } from "@/lib/chat-rules";
import { reportConversation, setBlocked, type ChatUserDto } from "@/lib/chat-client";
import { ChatAvatar } from "./chat-avatar";

export interface ConversationHeaderProps {
  conversationId: string;
  other: ChatUserDto | null;
  post: { id: string; title: string } | null;
  blockedByMe: boolean;
}

function IconDots(props: { size?: number; className?: string }) {
  const s = props.size ?? 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={props.className}
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function ConversationHeader({ conversationId, other, post, blockedByMe }: ConversationHeaderProps) {
  const t = useTranslations("Chat");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const { toast } = useToast();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleBlock() {
    if (!other) return;
    setBusy(true);
    try {
      await setBlocked(other.id, !blockedByMe);
      toast({
        title: blockedByMe
          ? t("unblockedToast", { name: other.name })
          : t("blockedToast", { name: other.name }),
        variant: "success",
      });
      // Sidan läser blockstatusen på servern → låt den rendera om.
      router.refresh();
    } catch (err) {
      toast({
        title: t("actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendReport() {
    const text = reason.trim();
    if (text.length < REPORT_REASON_MIN) {
      toast({ title: t("reportTooShort", { min: REPORT_REASON_MIN }), variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await reportConversation(conversationId, text);
      toast({ title: t("reportSent"), variant: "success" });
      setReportOpen(false);
      setReason("");
    } catch (err) {
      toast({
        title: t("actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const items: DropdownItem[] = [];
  if (post) {
    items.push({
      label: t("openThread"),
      icon: <IconExternalLink size={16} />,
      onSelect: () => router.push(threadPath(post.id)),
    });
  }
  if (other) {
    items.push({
      label: blockedByMe ? t("unblock") : t("block"),
      icon: <IconLock size={16} />,
      onSelect: () => void toggleBlock(),
      disabled: busy,
    });
  }
  items.push({
    label: t("report"),
    icon: <IconFlag size={16} />,
    danger: true,
    onSelect: () => setReportOpen(true),
  });

  return (
    <header className="flex items-center gap-2 border-b border-surface-border pb-3">
      {/* Appens bakåtcirkel (ui/back-circle) — alltid en LÄNK till listan här:
          samtalet öppnas lika ofta från en push som från listan. */}
      <BackCircle href="/meddelanden" />
      {other ? (
        <Link
          href={`/profil/${other.id}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pr-2 transition-colors hover:bg-surface-overlay/50"
        >
          <ChatAvatar name={other.name} avatarUrl={other.avatarUrl} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{other.name}</span>
            {post && (
              <span className="block truncate text-xs text-ink-faint">
                {t("about", { title: post.title })}
              </span>
            )}
          </span>
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-1">
          <ChatAvatar name={null} avatarUrl={null} size={36} />
          <span className="truncate text-sm font-medium italic text-ink-muted">
            {t("deletedAccount")}
          </span>
        </div>
      )}
      <DropdownMenu
        align="right"
        items={items}
        trigger={
          <span aria-label={t("menu")} className={CIRCLE_CLASS}>
            <IconDots size={20} />
          </span>
        }
      />

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t("reportTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)} disabled={busy}>
              {tCommon("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void sendReport()} loading={busy}>
              {t("reportSend")}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-muted">{t("reportBody")}</p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REPORT_REASON_MAX}
          placeholder={t("reportPlaceholder")}
          aria-label={t("reportTitle")}
        />
        <p className="mt-1.5 text-right text-xs tabular-nums text-ink-faint">
          {reason.trim().length}/{REPORT_REASON_MAX}
        </p>
      </Modal>
    </header>
  );
}
