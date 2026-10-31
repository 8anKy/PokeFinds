"use client";

/**
 * Giveaway (2026-10-13): pris, krav, mina lotter och reglerna på EN sida.
 * Lottmodellen bor i lib/giveaway.ts, räkningen i services/giveaway.ts.
 * Klient-sida med flit (som /mer/bjud-in): sessionen läses via API:t, så sidan
 * fungerar för gäster (länken delas från TikTok) utan auth() i serverträdet.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button, LinkButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { IconCheck, IconGift } from "@/components/ui/icons";
import { IconInstagram, IconTikTok } from "@/components/ui/brand-icons";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { SwipeBack } from "@/components/ui/swipe-back";
import { INSTAGRAM_URL, TIKTOK_URL } from "@/lib/social-links";
import { MAX_TICKETS, TICKETS, type TicketBreakdown } from "@/lib/giveaway";

/** Priset i katalogen — bilden är produktens egen (CM-proxyn), länken går till produktsidan. */
const PRIZE_SLUG = "30th-celebration-elite-trainer-box";
const PRIZE_IMAGE = "/api/cm-image/895551";

interface Status {
  phase: "upcoming" | "open" | "closed";
  startsAt: string;
  closesAt: string;
  discordAvailable: boolean;
  user: {
    joined: boolean;
    tickets: TicketBreakdown;
    counts: {
      scannedCards: number;
      qualifiedInvites: number;
      invitesInDiscord: number;
      hasRestockAlert: boolean;
      discordLinked: boolean;
      gradings: number;
    };
  } | null;
}

export default function GiveawayPage() {
  const t = useTranslations("Giveaway");
  const locale = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [invite, setInvite] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Tillbaka från "Koppla Discord" (/api/discord/callback) med ?discord=<status>.
  const [discordFailed, setDiscordFailed] = useState(false);
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("discord");
    // "nekad" = användaren tryckte Avbryt hos Discord — ett val, inget fel.
    if (status && status !== "ansluten" && status !== "nekad") setDiscordFailed(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/giveaway");
      if (!res.ok) throw new Error();
      setStatus((await res.json()) as Status);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Personlig inbjudningslänk — samma som /mer/bjud-in. Bara för den som är med.
  const joined = !!status?.user?.joined;
  useEffect(() => {
    if (!joined) return;
    void fetch("/api/invites/link")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url: string } | null) => d && setInvite(d))
      .catch(() => undefined);
  }, [joined]);

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Stockholm",
    }).format(new Date(iso));

  async function shareInvite() {
    if (!invite) return;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title: "Scoutr", text: t("shareText"), url: invite.url });
        return;
      } catch {
        // avbruten delning → kopiera
      }
    }
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* inget att göra */
    }
  }

  const user = status?.user ?? null;
  const closed = status?.phase === "closed";

  return (
    <SwipeBack fallback="/mer" coverViewport>
      {/* coverViewport gör ytan FIXED: sidans px-2.5 och bottenflikarnas luft
          följer inte med, så de står här (annars sidledsscroll + regler under flikarna). */}
      <div className="mx-auto max-w-md space-y-6 px-2.5 pb-[calc(var(--bottom-tabs-space)+1.5rem)] sm:px-6 lg:px-0 lg:pb-6">
        <SubpageHeader title={t("h1")} subtitle={t("subtitle")} fallback="/mer" />

        {/* Priset */}
        <div className="overflow-hidden rounded-2xl border border-holo-cyan/30 bg-holo-cyan/10">
          <Link
            href={`/produkter/${PRIZE_SLUG}`}
            className="flex h-56 items-center justify-center bg-surface-overlay/60 p-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PRIZE_IMAGE}
              alt={t("prizeTitle")}
              className="h-full w-auto max-w-full object-contain drop-shadow-xl"
            />
          </Link>
          <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-holo-cyan/15 text-holo-cyan ring-1 ring-holo-cyan/30">
              <IconGift size={22} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-holo-cyan">
                {t("prizeEyebrow")}
              </p>
              <p className="mt-0.5 text-base font-semibold leading-snug text-ink">{t("prizeTitle")}</p>
              <p className="mt-1 text-xs text-ink-muted">{t("prizeBody")}</p>
            </div>
          </div>
          {status && (
            <div className="mt-4 border-t border-holo-cyan/20 pt-3 text-xs text-ink-muted">
              <p className="font-medium text-ink">
                {status.phase === "upcoming"
                  ? t("phaseUpcoming", { date: fmt(status.startsAt) })
                  : status.phase === "open"
                    ? t("phaseOpen", { date: fmt(status.closesAt) })
                    : t("phaseClosed")}
              </p>
              {!closed && <p className="mt-0.5">{t("endsEarly")}</p>}
            </div>
          )}
          </div>
        </div>

        {loadError && <p className="text-sm text-fall">{t("loadError")}</p>}

        {closed && <p className="text-sm text-ink-muted">{t("closedBody")}</p>}

        {/* Så är du med */}
        {!closed && (
          <section>
            <h2 className="text-sm font-semibold text-ink">{t("stepsTitle")}</h2>
            <ol className="card-surface mt-2 divide-y divide-surface-border">
              <Step n={1} label={t("step1")} href={TIKTOK_URL} icon={<IconTikTok size={16} />} open={t("open")} />
              <Step n={2} label={t("step2")} href={INSTAGRAM_URL} icon={<IconInstagram size={16} />} open={t("open")} />
              <Step n={3} label={t("step3")} />
              <Step n={4} label={t("step4")} />
            </ol>
          </section>
        )}

        {/* Hur lotterna samlas — syns FÖRE anmälan, annars förstår man inte vad man anmäler sig till. */}
        {status && !closed && !user?.joined && (
          <section>
            <h2 className="text-sm font-semibold text-ink">{t("earnTitle")}</h2>
            <p className="mt-1 text-xs text-ink-muted">{t("earnIntro")}</p>
            <ul className="card-surface mt-2 divide-y divide-surface-border">
              <EarnRow label={t("rowAccount")} hint={t("earnAccountHint")} amount={`+${TICKETS.account}`} />
              <EarnRow label={t("rowScans")} hint={t("rowScansHint")} amount={`+${TICKETS.perScan}`} />
              <EarnRow label={t("rowInvites")} hint={t("rowInvitesHint")} amount={`+${TICKETS.perInvite}`} />
              {status.discordAvailable && (
                <EarnRow
                  label={t("rowInviteDiscord")}
                  hint={t("rowInviteDiscordHint")}
                  amount={`+${TICKETS.perInviteDiscord}`}
                />
              )}
              <EarnRow label={t("rowRestock")} hint={t("rowRestockHint")} amount={`+${TICKETS.restockAlert}`} />
              <EarnRow label={t("rowGrading")} hint={t("rowGradingHint")} amount={`+${TICKETS.perGrading}`} />
              {status.discordAvailable && (
                <EarnRow label={t("rowDiscord")} hint={t("rowDiscordHint")} amount={`+${TICKETS.discord}`} />
              )}
            </ul>
            <p className="mt-2 text-xs text-ink-faint">{t("earnOdds", { max: MAX_TICKETS })}</p>
          </section>
        )}

        {/* Gäst: konto först */}
        {status && !user && !closed && (
          <div className="card-surface space-y-3 p-4">
            <p className="text-sm text-ink-muted">{t("guestBody")}</p>
            <div className="flex gap-2">
              <LinkButton href="/registrera?callbackUrl=%2Fgiveaway" size="sm">
                {t("guestRegister")}
              </LinkButton>
              <LinkButton href="/logga-in?callbackUrl=%2Fgiveaway" size="sm" variant="outline">
                {t("guestLogin")}
              </LinkButton>
            </div>
          </div>
        )}

        {/* Inloggad, inte anmäld */}
        {user && !closed && !user.joined && <JoinForm onDone={setStatus} />}

        {/* Mina lotter */}
        {user?.joined && (
          <section className="space-y-3">
            <div className="card-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">{t("ticketsTitle")}</h2>
                <span className="text-xs text-ink-faint">{t("ticketsMax", { max: MAX_TICKETS })}</span>
              </div>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums tracking-[-0.02em] text-ink">
                {t("ticketsTotal", { count: user.tickets.total })}
              </p>
              <p className="mt-1 text-xs text-ink-faint">{t("ticketsLag")}</p>
            </div>

            <ul className="card-surface divide-y divide-surface-border">
              <TicketRow
                label={t("rowAccount")}
                hint={t("rowAccountHint")}
                value={`${user.tickets.account}/${TICKETS.account}`}
                done
              />
              <TicketRow
                label={t("rowScans")}
                hint={t("rowScansHint")}
                value={`${Math.min(user.counts.scannedCards, TICKETS.maxScans)}/${TICKETS.maxScans}`}
                done={user.counts.scannedCards >= TICKETS.maxScans}
                action={
                  !closed && user.counts.scannedCards < TICKETS.maxScans ? (
                    <LinkButton href="/skanna" size="sm" variant="outline">
                      {t("ctaScan")}
                    </LinkButton>
                  ) : null
                }
              />
              <TicketRow
                label={t("rowInvites")}
                hint={t("rowInvitesHint")}
                value={`${Math.min(user.counts.qualifiedInvites, TICKETS.maxInvites)}/${TICKETS.maxInvites}`}
                done={user.counts.qualifiedInvites >= TICKETS.maxInvites}
                action={
                  !closed && invite && user.counts.qualifiedInvites < TICKETS.maxInvites ? (
                    <Button size="sm" variant="outline" onClick={shareInvite}>
                      {copied ? t("copied") : t("ctaInvite")}
                    </Button>
                  ) : null
                }
              />
              {(status?.discordAvailable || user.counts.invitesInDiscord > 0) && (
                <TicketRow
                  label={t("rowInviteDiscord")}
                  hint={t("rowInviteDiscordHint")}
                  value={`${Math.min(user.counts.invitesInDiscord, TICKETS.maxInvites)}/${TICKETS.maxInvites}`}
                  done={user.counts.invitesInDiscord >= TICKETS.maxInvites}
                />
              )}
              <TicketRow
                label={t("rowRestock")}
                hint={t("rowRestockHint")}
                value={`${user.tickets.restock}/${TICKETS.restockAlert}`}
                done={user.counts.hasRestockAlert}
                action={
                  !closed && !user.counts.hasRestockAlert ? (
                    <LinkButton href="/produkter" size="sm" variant="outline">
                      {t("ctaWatch")}
                    </LinkButton>
                  ) : null
                }
              />
              <TicketRow
                label={t("rowGrading")}
                hint={t("rowGradingHint")}
                value={`${Math.min(user.counts.gradings, TICKETS.maxGradings)}/${TICKETS.maxGradings}`}
                done={user.counts.gradings >= TICKETS.maxGradings}
                action={
                  !closed && user.counts.gradings < TICKETS.maxGradings ? (
                    <LinkButton href="/gradera" size="sm" variant="outline">
                      {t("ctaGrade")}
                    </LinkButton>
                  ) : null
                }
              />
              {(status?.discordAvailable || user.counts.discordLinked) && (
                <TicketRow
                  label={t("rowDiscord")}
                  hint={t("rowDiscordHint")}
                  value={`${user.tickets.discord}/${TICKETS.discord}`}
                  done={user.counts.discordLinked}
                  action={
                    !closed && !user.counts.discordLinked ? (
                      // Vanlig länk, inte Link: OAuth-flödet lämnar appen och kommer tillbaka hit.
                      <a
                        href="/api/discord/connect?return=/giveaway"
                        className="inline-flex h-8 shrink-0 items-center rounded-lg border border-surface-border px-3 text-sm font-medium text-ink transition hover:border-holo-cyan/40 hover:text-holo-cyan"
                      >
                        {t("ctaDiscord")}
                      </a>
                    ) : null
                  }
                />
              )}
            </ul>
            {discordFailed && !user.counts.discordLinked && (
              <p className="text-sm text-fall">{t("discordError")}</p>
            )}

            <p className="text-xs text-ink-muted">{t("joinedNote")}</p>
          </section>
        )}

        {/* Regler */}
        {status && (
          <details className="card-surface group p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink">{t("rulesTitle")}</summary>
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-ink-muted">
              <p>{t("rulesOrganizer")}</p>
              <p>{t("rulesPeriod", { start: fmt(status.startsAt), end: fmt(status.closesAt) })}</p>
              <ol className="list-decimal space-y-1.5 pl-4">
                {(t.raw("rulesList") as string[]).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
              <Link href="/villkor" className="inline-block text-ink-faint underline-offset-2 hover:underline">
                /villkor
              </Link>
            </div>
          </details>
        )}
      </div>
    </SwipeBack>
  );
}

function Step({
  n,
  label,
  href,
  icon,
  open,
}: {
  n: number;
  label: string;
  href?: string;
  icon?: React.ReactNode;
  open?: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-xs font-semibold text-ink">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-sm text-ink">{label}</span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-surface-border px-3 py-1 text-xs font-medium text-ink transition hover:border-holo-cyan/40 hover:text-holo-cyan"
        >
          {icon}
          {open}
        </a>
      )}
    </li>
  );
}

function EarnRow({ label, hint, amount }: { label: string; hint: string; amount: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>
      </div>
      <span className="shrink-0 rounded-full bg-holo-cyan/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-holo-cyan">
        {amount}
      </span>
    </li>
  );
}

function TicketRow({
  label,
  hint,
  value,
  done,
  action,
}: {
  label: string;
  hint: string;
  value: string;
  done?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          {label}
          {done && <IconCheck size={14} className="text-rise" />}
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-ink-muted">{value}</span>
      {action}
    </li>
  );
}

function JoinForm({ onDone }: { onDone: (s: Status) => void }) {
  const t = useTranslations("Giveaway");
  const [accept, setAccept] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accept) {
      setError(t("mustAccept"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/giveaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: true }),
      });
      const data = (await res.json().catch(() => null)) as (Status & { error?: string }) | null;
      if (!res.ok || !data) {
        setError(data?.error ?? t("joinError"));
        return;
      }
      onDone(data);
    } catch {
      setError(t("joinError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-ink">{t("formTitle")}</h2>
      <label htmlFor="gw-accept" className="flex cursor-pointer items-start gap-2.5 text-xs text-ink-muted">
        <Checkbox
          id="gw-accept"
          checked={accept}
          onChange={(e) => setAccept(e.target.checked)}
          className="mt-0.5 shrink-0"
        />
        <span>{t("acceptLabel")}</span>
      </label>
      {error && <p className="text-sm text-fall">{error}</p>}
      <Button type="submit" loading={saving} className="w-full">
        {t("joinButton")}
      </Button>
    </form>
  );
}
