"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { Button, LinkButton } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { CommentDto } from "@/services/community";
import { RelativeTime } from "./relative-time";
import { useForumViewer } from "./use-forum-viewer";

/**
 * Svarslista + svarsformulär. Listan kommer serverrenderad; nya svar läggs
 * på optimistiskt och byts mot serverns rad. Svar från blockerade användare
 * (åt båda hållen) döljs i klienten — servern vet inte vem som tittar på en
 * ISR-sida.
 */
export function Replies({ postId, initial }: { postId: string; initial: CommentDto[] }) {
  const t = useTranslations("Forum");
  const router = useRouter();
  const { toast } = useToast();
  const { loggedIn, viewer, state } = useForumViewer([postId]);
  const [comments, setComments] = useState<CommentDto[]>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocked = new Set(state.blockedIds);
  const visible = comments.filter((c) => !blocked.has(c.user.id));
  const loginHref = `/logga-in?callbackUrl=${encodeURIComponent(`/forum/t/${postId}`)}`;

  async function submit() {
    if (!loggedIn) {
      router.push(loginHref);
      return;
    }
    const content = text.trim();
    if (!content) {
      setError(t("replyEmpty"));
      return;
    }
    setBusy(true);
    setError(null);
    const tempId = `temp-${Date.now()}`;
    const optimistic: CommentDto = {
      id: tempId,
      content,
      createdAt: new Date().toISOString(),
      user: {
        id: viewer?.id ?? "",
        name: viewer?.name ?? "",
        avatarUrl: null,
        reputationScore: 0,
      },
    };
    setComments((prev) => [...prev, optimistic]);
    setText("");
    try {
      const saved = await apiFetch<CommentDto>(`/api/community/posts/${postId}/comments`, {
        method: "POST",
        body: { content },
      });
      setComments((prev) => prev.map((c) => (c.id === tempId ? saved : c)));
      toast({ title: t("replyPosted"), variant: "success" });
    } catch (e) {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setText(content);
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t("replies")} className="space-y-4">
      <h2 className="font-display text-lg font-semibold text-ink">
        {t("repliesCount", { count: visible.length })}
      </h2>

      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("noReplies")}</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((c) => (
            <li key={c.id} className="card-surface rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <Link
                  href={`/profil/${c.user.id}`}
                  className="font-medium text-ink hover:text-holo-cyan"
                >
                  {c.user.name}
                </Link>
                {c.user.reputationScore > 100 && <Badge variant="holo">{t("veteran")}</Badge>}
                <span aria-hidden="true">·</span>
                <RelativeTime date={c.createdAt} />
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{c.content}</p>
            </li>
          ))}
        </ul>
      )}

      {loggedIn === null ? null : loggedIn ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="newReply">{t("replyLabel")}</Label>
          <Textarea
            id="newReply"
            placeholder={t("replyPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={5000}
          />
          <FieldError message={error} />
          <Button type="submit" loading={busy}>
            {t("replySend")}
          </Button>
        </form>
      ) : (
        <LinkButton href={loginHref} variant="outline">
          {t("loginToReply")}
        </LinkButton>
      )}
    </section>
  );
}
