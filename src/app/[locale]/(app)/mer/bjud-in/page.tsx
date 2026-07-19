"use client";

/**
 * Bjud in vänner (#10): skapa engångskoder, dela länken, följ status.
 * 3 vänner som skapar NYA konton och verifierar sin e-post = 1 månad Pro.
 * Klient-sida med flit (samma mönster som övrig chrome): session läses via
 * API:t, sidan kan för-renderas utan auth() i serverträdet.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconCheck, IconGift, IconShare } from "@/components/ui/icons";
import { PageBackButton } from "@/components/layout/page-back-button";
import { LockScroll } from "@/components/lock-scroll";

interface InviteRow {
  id: string;
  createdAt: string;
  usedAt: string | null;
  verifiedAt: string | null;
  rewardedAt: string | null;
  usedByName: string | null;
}
interface InviteStatus {
  invites: InviteRow[];
  progress: number;
  required: number;
  bonusProUntil: string | null;
  /** Engångs: belöningen uttagen → visa klart-läge, inga nya koder. */
  earned: boolean;
}

function inviteUrl(code: string): string {
  return `${window.location.origin}/registrera?invite=${code}`;
}

export default function InvitePage() {
  const t = useTranslations("Invite");
  const [status, setStatus] = useState<InviteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invites");
      if (!res.ok) throw new Error();
      setStatus((await res.json()) as InviteStatus);
    } catch {
      setError(t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAndShare() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/invites", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
      if (!res.ok || !data?.code) {
        setError(data?.error ?? t("createError"));
        return;
      }
      await shareOrCopy(data.code);
      void load();
    } finally {
      setCreating(false);
    }
  }

  async function shareOrCopy(code: string) {
    const url = inviteUrl(code);
    // Native delnings-ark BARA på touch-enheter: på desktop öppnar navigator.share
    // OS-dialogen och promiset hänger tills den stängs (knappen snurrade för evigt,
    // upptäckt vid verifiering). Desktop = kopiera direkt.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title: "Foilio", text: t("shareText"), url });
        return;
      } catch {
        // avbruten delning → fall igenom till kopiering
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2500);
    } catch {
      setError(t("copyError"));
    }
  }

  const bonusActive =
    status?.bonusProUntil != null && new Date(status.bonusProUntil).getTime() > Date.now();
  const openInvites = status?.invites.filter((i) => !i.usedAt) ?? [];
  const usedInvites = status?.invites.filter((i) => i.usedAt) ?? [];

  // Engångs: uttagen belöning → bara ett tack-kort (sektionen är borta ur /mer,
  // men djuplänken ska landa snyggt, inte i ett halvdött formulär).
  if (status?.earned) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <LockScroll />
        <header>
          <PageBackButton />
          <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        </header>
        <div className="rounded-2xl border border-holo-cyan/30 bg-holo-cyan/10 p-5 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-holo-cyan/15 text-holo-cyan ring-1 ring-holo-cyan/30">
            <IconCheck size={24} />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">{t("doneTitle")}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {bonusActive && status.bonusProUntil
              ? t("doneBodyActive", { date: new Date(status.bonusProUntil).toLocaleDateString() })
              : t("doneBody")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <LockScroll />
      <header>
        <PageBackButton />
        <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("subtitle")}</p>
      </header>

      {/* Framsteg mot nästa månad */}
      <div className="rounded-2xl border border-holo-cyan/30 bg-holo-cyan/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-holo-cyan/15 text-holo-cyan ring-1 ring-holo-cyan/30">
            <IconGift size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {t("progress", { count: status?.progress ?? 0, required: status?.required ?? 3 })}
            </p>
            <p className="text-xs text-ink-muted">{t("progressHint")}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: status?.required ?? 3 }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < (status?.progress ?? 0) ? "bg-holo-cyan" : "bg-surface-overlay"
              }`}
            />
          ))}
        </div>
        {bonusActive && status?.bonusProUntil && (
          <p className="mt-3 text-xs text-rise">
            {t("bonusActive", {
              date: new Date(status.bonusProUntil).toLocaleDateString(),
            })}
          </p>
        )}
      </div>

      <Button onClick={createAndShare} loading={creating} className="w-full" size="lg">
        <IconShare size={18} className="mr-2" />
        {t("createButton")}
      </Button>
      {error && <p className="text-sm text-fall">{error}</p>}

      {/* Oanvända länkar — dela igen */}
      {openInvites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink">{t("openTitle")}</h2>
          <ul className="mt-2 space-y-2">
            {openInvites.map((i) => (
              <li
                key={i.id}
                className="card-surface flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                  {typeof window !== "undefined" ? inviteUrl(i.id) : i.id}
                </span>
                <button
                  type="button"
                  onClick={() => shareOrCopy(i.id)}
                  className="shrink-0 rounded-full border border-surface-border px-3 py-1 text-xs font-medium text-ink transition hover:border-holo-cyan/40 hover:text-holo-cyan"
                >
                  {copiedCode === i.id ? t("copied") : t("shareAgain")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Använda inbjudningar — status per vän */}
      {usedInvites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink">{t("usedTitle")}</h2>
          <ul className="mt-2 space-y-2">
            {usedInvites.map((i) => (
              <li
                key={i.id}
                className="card-surface flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-ink">
                  {i.usedByName ?? t("unknownFriend")}
                </span>
                {i.verifiedAt ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-rise">
                    <IconCheck size={14} />
                    {t("statusVerified")}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-ink-muted">{t("statusPending")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-faint">{t("terms")}</p>
    </div>
  );
}
