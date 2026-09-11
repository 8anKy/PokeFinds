"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { getSharedSession } from "@/lib/client-session";
import { apiFetch } from "@/lib/client-api";
import { Button, LinkButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconMail } from "@/components/ui/icons";
import { captureRouteSwipeSnapshot } from "@/components/layout/route-swipe-snapshot";

/**
 * "Kontakta säljaren" / "Skicka meddelande" (kontrakt 4 i briefen): startar
 * eller återanvänder parets konversation via POST /api/chat/conversations och
 * går till den. Dold för trådskaparen; inloggningslänk för utloggade.
 */
export function ContactButton({
  authorId,
  postId,
  marketplace,
  callbackPath,
  className,
}: {
  authorId: string;
  postId: string;
  marketplace: boolean;
  callbackPath: string;
  /** Anroparen bestämmer bredden — på en annons är det här huvudåtgärden. */
  className?: string;
}) {
  const t = useTranslations("Forum");
  const router = useRouter();
  const { toast } = useToast();
  const loggedIn = useAuthHint();
  const [viewerId, setViewerId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loggedIn !== true) return;
    let cancelled = false;
    void getSharedSession().then((s) => {
      if (!cancelled) setViewerId(s?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  const label = marketplace ? t("contactSeller") : t("sendMessage");

  if (loggedIn === null) return null;
  if (!loggedIn) {
    return (
      <LinkButton
        href={`/logga-in?callbackUrl=${encodeURIComponent(callbackPath)}`}
        variant="outline"
        size="sm"
        className={className}
      >
        <IconMail size={16} />
        {t("loginToContact")}
      </LinkButton>
    );
  }
  if (viewerId === undefined || viewerId === authorId) return null;

  async function start() {
    setBusy(true);
    try {
      const res = await apiFetch<{ id: string }>("/api/chat/conversations", {
        method: "POST",
        body: { userId: authorId, postId },
      });
      const destination = `/meddelanden/${res.id}`;
      captureRouteSwipeSnapshot(destination);
      router.push(destination);
    } catch (e) {
      toast({
        title: t("contactFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={() => void start()} loading={busy} className={className}>
      <IconMail size={16} />
      {label}
    </Button>
  );
}
