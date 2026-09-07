"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { apiErrorCode, apiFetch } from "@/lib/client-api";
import { mergeComments, recallOwnComments, rememberOwnComment } from "@/lib/forum-client";
import { FORUM_RULES_CODE, PROFANITY_CODE } from "@/lib/profanity";
import { requestForumRules } from "./forum-rules-gate";
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
 *
 * ⛔ Sidan är ISR (300 s) OCH Nexts klient-routercache serverar samma RSC-
 * nyttolast i 30 s: gick man ut ur tråden och in igen direkt efter att ha
 * svarat renderades listan utan svaret, och det "kom tillbaka" först minuter
 * senare. Svaret var sparat hela tiden — det var LÄSNINGEN som var gammal.
 * Egna svar minns vi därför i fliken och slår ihop dem med serverns lista vid
 * montering (`lib/forum-client.ts`). Det kostar ingen extra läsning.
 */
export function Replies({ postId, initial }: { postId: string; initial: CommentDto[] }) {
  const t = useTranslations("Forum");
  const router = useRouter();
  const { toast } = useToast();
  const { loggedIn, viewer, state, ready } = useForumViewer([postId]);
  // Svarsfältet är sidans NEDERSTA element: i appen läggs tangentbordet ovanpå
  // webbvyn (Keyboard resize:"none") utan att sidan krymper, så fältet hamnar
  // bakom det och det finns ingen rullmån kvar att lyfta upp det med. Hooken ger
  // rullmånen (padding) och rullar fältet ovanför tangentbordet — samma som
  // /forum/ny. Se hooks/use-keyboard-inset.ts.
  const kbInset = useKeyboardInset();
  const [comments, setComments] = useState<CommentDto[]>(() =>
    mergeComments(recallOwnComments(postId), initial)
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Serverns lista bytte tråd (eller renderades om) — börja om från den, med
  // egna svar ovanpå. ⛔ Aldrig `prev` här: rutten är ett dynamiskt segment och
  // komponenten kan återanvändas mellan två trådar.
  useEffect(() => {
    setComments(mergeComments(recallOwnComments(postId), initial));
  }, [postId, initial]);

  // ⛔ SERVERNS LISTA KAN VARA UPP TILL 300 s GAMMAL (ISR) + 30 s (routercache):
  // mätt 2026-09-07 sa flödet "1 svar" medan tråden man öppnade sa "Inga svar
  // ännu". /me bär därför en färsk räknare, och skiljer den sig från det vi
  // renderade hämtar vi listan EN gång. Stämmer de (det vanliga) kostar det
  // ingenting — och egna svar ligger redan i minnet, så den här vägen är för
  // ANDRAS svar.
  const refetched = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const fresh = state.counts[postId];
    if (!fresh || fresh.commentCount === comments.length) return;
    if (refetched.current === postId) return;
    refetched.current = postId;
    void apiFetch<{ items: CommentDto[] }>(`/api/community/posts/${postId}/comments`)
      .then((res) => setComments((prev) => mergeComments(prev, res.items)))
      .catch(() => {
        // nätverksfel — behåll det som visas
      });
  }, [ready, state.counts, postId, comments.length]);

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
      // Så att svaret finns kvar när man går ut ur tråden och in igen — se filhuvudet.
      rememberOwnComment(postId, saved);
      toast({ title: t("replyPosted"), variant: "success" });
      // Servern invaliderade ISR-posterna (revalidateForum), men Nexts KLIENT-
      // routercache håller en förhämtad rutt i upp till 5 MINUTER — utan det här
      // visade /forum gammal svarsräknare när man gick tillbaka. Samma skäl som
      // composer.tsx. Neon är redan vaken av skrivningen.
      router.refresh();
    } catch (e) {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setText(content);
      const code = apiErrorCode(e);
      if (code === FORUM_RULES_CODE) {
        requestForumRules();
        setError(t("rulesRequired"));
      } else if (code === PROFANITY_CODE) {
        setError(t("profanityBlocked"));
      } else {
        setError(e instanceof Error ? e.message : t("somethingWrong"));
      }
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
          style={kbInset ? { paddingBottom: kbInset } : undefined}
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
