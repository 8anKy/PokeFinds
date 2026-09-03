"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { Button, LinkButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconCheck, IconPlus } from "@/components/ui/icons";
import { invalidatePersonalState, useForumViewer } from "./use-forum-viewer";

/**
 * "Gå med"/"Lämna" på gruppsidan. Tillståndet kommer från /api/community/me
 * (bara för inloggade); utloggade får en inloggningslänk i stället för en
 * knapp som skulle studsa på 401.
 */
export function JoinGroupButton({ slug, groupId }: { slug: string; groupId: string }) {
  const t = useTranslations("Forum");
  const router = useRouter();
  const { toast } = useToast();
  const { loggedIn, state, ready } = useForumViewer([]);
  const [joined, setJoined] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready) setJoined(state.joinedGroupIds.includes(groupId));
  }, [ready, state.joinedGroupIds, groupId]);

  if (loggedIn === null) return <div className="h-10 w-28" aria-hidden />;
  if (!loggedIn) {
    return (
      <LinkButton href={`/logga-in?callbackUrl=/forum/g/${slug}`} variant="outline" size="sm">
        {t("loginToJoin")}
      </LinkButton>
    );
  }

  async function toggle() {
    if (joined === null) return;
    const next = !joined;
    setBusy(true);
    try {
      await apiFetch(`/api/community/groups/${encodeURIComponent(slug)}/join`, {
        method: next ? "POST" : "DELETE",
      });
      setJoined(next);
      invalidatePersonalState();
      // Medlemsräknaren ligger i ISR-HTML:en och är just revaliderad på servern.
      router.refresh();
    } catch (e) {
      toast({
        title: t("somethingWrong"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={joined ? "secondary" : "primary"}
      size="sm"
      onClick={() => void toggle()}
      loading={busy}
      disabled={joined === null}
      aria-pressed={joined === true}
    >
      {joined ? <IconCheck size={16} /> : <IconPlus size={16} />}
      {joined ? t("joined") : t("join")}
    </Button>
  );
}
