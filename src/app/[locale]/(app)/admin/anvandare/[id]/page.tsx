/**
 * ADMIN → ANVÄNDARDETALJ (2026-08-14).
 *
 * Vad kostar den här användaren, per funktion, och vem är hen? Listan visar en
 * rad per användare och kan inte bära det här utan att bli oläslig.
 *
 * ⛔ **TVÅ FÖNSTER, INTE ETT.** "Denna månad" är fönstret KVOTERNA räknar i
 *    (getScannerQuota/getGradingQuota använder `startOfMonthUtc`), så det är det
 *    enda tal som går att jämföra med vad kunden ser i appen. "30 dygn" är det
 *    enda tal som är stabilt över ett månadsskifte. Visas bara ett av dem läser
 *    någon fel siffra den 1:a i månaden.
 *
 * ⛔ **INGA INFRAKOSTNADER.** Neon/Railway/Resend är delade och debiteras per
 *    vaken tid respektive per abonnemang, inte per användare — se filhuvudet i
 *    services/admin/user-costs.ts. Larm redovisas som ANTAL.
 */
import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPro } from "@/lib/plan";
import { RENEWAL_LABELS, renewalStatus } from "@/lib/subscription-status";
import { formatDateTime, formatPrice } from "@/lib/format";
import { startOfMonthUtc, utcDaysAgo } from "@/lib/utils";
import { parseNotificationSettings } from "@/lib/notification-settings";
import {
  COST_WINDOW_DAYS,
  loadUserCosts,
} from "@/services/admin/user-costs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DonutChart } from "@/components/features/admin/donut-chart";
import { CATEGORICAL } from "@/components/features/admin/chart-palette";
import { getScannerQuota } from "@/services/scanner";
import { getGradingQuota } from "@/services/grading";
import { effectivePlanTier } from "@/lib/plan";
import { AdminRequired } from "../../admin-required";
import { LastSeen, formatCostOre } from "../user-bits";
import { UserActions } from "../user-actions";
import { BarList, DailyBars, FactChip, QuotaBar, SubscriptionTimeline, ToggleChip } from "./user-visuals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Användare · Admin" };

/**
 * NYCKELTAL ÖVERST (ägaren 2026-09-16: "ögat ska fånga det direkt, som i
 * översikten"). Samma tegel som översiktens StatCard: etikett, stort tal, en
 * rad förklaring. Talen är de man faktiskt kommer hit för — kostnaden och
 * användningen denna månad, bevakningarna, samlingen.
 */
function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </Card>
  );
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      planTier: true,
      bonusProUntil: true,
      stripeProUntil: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripeCancelAtPeriodEnd: true,
      proSince: true,
      rcWillRenew: true,
      rcExpiresAt: true,
      rcEnvironment: true,
      emailVerifiedAt: true,
      onboardingCompleted: true,
      isPublicCollection: true,
      reputationScore: true,
      notificationSettings: true,
      lastPushError: true,
      lastSeenAt: true,
      createdAt: true,
      discordUsername: true,
      discordLinkedAt: true,
      traderaUserId: true,
      traderaTokenExpiresAt: true,
      attributedAt: true,
      creatorCode: { select: { code: true, creatorName: true } },
      pushTokens: { select: { platform: true, createdAt: true } },
      // Vad hen bevakar — det ägaren vill se bredvid siffrorna.
      watchlistItems: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          restockAlert: true,
          priceAlert: true,
          targetPrice: true,
          isPaused: true,
          createdAt: true,
          product: { select: { title: true, slug: true, lowestPriceOre: true } },
        },
      },
      setWatches: { select: { set: { select: { id: true, name: true } } } },
      _count: {
        select: {
          watchlistItems: true,
          setWatches: true,
          collectionItems: true,
          posts: true,
          comments: true,
          sales: true,
          scannerJobs: true,
          gradingJobs: true,
          alerts: true,
          invitesSent: true,
        },
      },
    },
  });
  if (!user) notFound();

  const monthStart = startOfMonthUtc();
  const windowStart = utcDaysAgo(COST_WINDOW_DAYS);
  const [monthCosts, windowCosts] = await Promise.all([
    loadUserCosts([user.id], monthStart),
    loadUserCosts([user.id], windowStart),
  ]);
  const month = monthCosts.get(user.id)!;
  const window = windowCosts.get(user.id)!;

  const notif = parseNotificationSettings(user.notificationSettings);
  const pro = isPro(user);

  // Kvoterna EXAKT som kunden ser dem i appen (samma funktioner), och kontots
  // skanningar per dygn de senaste 30 dagarna (fyllda luckor — en tom dag är noll).
  const DAYS = 30;
  const [scanQuota, gradeQuota, dailyRaw] = await Promise.all([
    getScannerQuota(user.id, effectivePlanTier(user), user.role),
    getGradingQuota(user.id, effectivePlanTier(user)),
    prisma.$queryRaw<{ date: string; value: number }[]>`
      select to_char(date_trunc('day', "createdAt" at time zone 'UTC'), 'YYYY-MM-DD') as date,
             count(*)::int as value
      from "ScannerJob"
      where "userId" = ${user.id} and "createdAt" >= now() - interval '30 days'
      group by 1 order by 1
    `,
  ]);
  const byDate = new Map(dailyRaw.map((r) => [r.date, r.value]));
  const daily: { date: string; value: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = utcDaysAgo(i).toISOString().slice(0, 10);
    daily.push({ date: d, value: byDate.get(d) ?? 0 });
  }

  // Varifrån kommer Pro? Fyra källor (isPro) — säg VILKEN, inte bara "Pro".
  const now = Date.now();
  const proSource = !pro
    ? null
    : user.role === "ADMIN" || user.role === "SUPERADMIN"
      ? "Roll"
      : user.planTier === "PREMIUM"
        ? "App Store / Play"
        : user.stripeProUntil && user.stripeProUntil.getTime() > now
          ? "Stripe (webb)"
          : "Gåva";
  const proUntil =
    user.planTier === "PREMIUM"
      ? user.rcExpiresAt
      : user.stripeProUntil && user.stripeProUntil.getTime() > now
        ? user.stripeProUntil
        : user.bonusProUntil && user.bonusProUntil.getTime() > now
          ? user.bonusProUntil
          : null;
  const renewal = renewalStatus(user);
  const devices = user.pushTokens.map((t) => t.platform.toLowerCase());
  const costSlices = [
    { key: "scanner", label: "Kortskanning", value: month.scanner.costOre, color: CATEGORICAL[0], display: formatCostOre(month.scanner.costOre) },
    { key: "grading", label: "AI-gradering", value: month.grading.costOre, color: CATEGORICAL[1], display: formatCostOre(month.grading.costOre) },
  ].filter((x) => x.value > 0);

  const activeWatches = user.watchlistItems.filter((w) => !w.isPaused);
  const dt = (d: Date | null | undefined) => (d ? formatDateTime(d) : "–");

  return (
    <div className="space-y-4">
      {/* HUVUD: vem är hen, i chips — ett tillstånd per chip. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{user.name}</h2>
          <p className="text-sm text-ink-muted">
            {user.email} · konto sedan {user.createdAt.toISOString().slice(0, 10)} · senast sedd{" "}
            <LastSeen iso={user.lastSeenAt?.toISOString() ?? null} />
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pro ? <FactChip tone="pro" title="isPro: planTier ∪ bonus ∪ Stripe ∪ roll">Pro · {proSource}</FactChip> : <FactChip>Gratis</FactChip>}
            {user.role !== "USER" && <FactChip tone="warn">{user.role}</FactChip>}
            {user.emailVerifiedAt ? <FactChip tone="good">✓ E-post bekräftad</FactChip> : <FactChip tone="warn">E-post obekräftad</FactChip>}
            {devices.length > 0 ? (
              <FactChip tone="good" title="Registrerad push-token bevisar appen">App · {[...new Set(devices)].join(" + ")}</FactChip>
            ) : (
              <FactChip title="Ingen push-token — appen kan ändå finnas utan push-tillstånd">Ingen app-enhet</FactChip>
            )}
            {user.discordUsername && <FactChip tone="good" title={`Kopplad ${dt(user.discordLinkedAt)}`}>Discord · {user.discordUsername}</FactChip>}
            {user.traderaUserId && <FactChip tone="good" title={user.traderaTokenExpiresAt ? `Token t.o.m. ${dt(user.traderaTokenExpiresAt)}` : undefined}>Tradera</FactChip>}
            {user.creatorCode && <FactChip title={user.attributedAt ? `Attribuerad ${dt(user.attributedAt)}` : undefined}>Kreatör · {user.creatorCode.code}</FactChip>}
            {user.rcEnvironment === "SANDBOX" && <FactChip tone="warn">Sandbox-köp</FactChip>}
            {!user.onboardingCompleted && <FactChip>Onboarding ej klar</FactChip>}
            {user.isPublicCollection && <FactChip>Publik samling</FactChip>}
          </div>
        </div>
        <Link href="/admin/anvandare" className="shrink-0 text-sm text-holo-cyan transition-opacity hover:opacity-80">
          ← Alla användare
        </Link>
      </div>

      {/* NYCKELTAL */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Skanningar denna månad" value={month.scanner.rows} hint={`${user._count.scannerJobs} totalt`} />
        <StatTile label="Graderingar denna månad" value={month.grading.rows} hint={`${user._count.gradingJobs} totalt`} />
        <StatTile
          label="AI-kostnad denna månad"
          value={formatCostOre(month.totalOre)}
          hint={month.totalUnmeasured > 0 ? `+${month.totalUnmeasured} omätta` : `${formatCostOre(window.totalOre)} senaste ${COST_WINDOW_DAYS} d`}
        />
        <StatTile label="Bevakningar" value={activeWatches.length} hint={`${user._count.setWatches} bevakade set`} />
        <StatTile label="Samling" value={user._count.collectionItems} hint={`${user._count.sales} sålda`} />
        <StatTile label="Larm denna månad" value={month.emailAlerts + month.pushAlerts} hint={`${month.emailAlerts} mejl · ${month.pushAlerts} push`} />
      </div>

      {/* RAD 1: kvot · kostnad · prenumeration */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Kvot denna månad</h3>
          <div className="space-y-4">
            <QuotaBar
              label="Skanningar"
              used={scanQuota.used}
              limit={scanQuota.limit}
              unlimited={pro}
              hint="Identifierade kort denna månad — exakt det tal kunden ser i appen. Enhetens gästskanningar kan ingå."
            />
            <QuotaBar
              label="AI-graderingar"
              used={gradeQuota.used}
              limit={gradeQuota.limit ?? 0}
              unlimited={gradeQuota.limit == null}
              hint="Misslyckade graderingar räknas inte."
            />
          </div>
          <div className="mt-4">
            <DailyBars points={daily} label="skanningar" />
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-semibold">AI-kostnad denna månad</h3>
          {costSlices.length > 0 ? (
            <DonutChart slices={costSlices} centerLabel="denna månad" centerValue={formatCostOre(month.totalOre)} />
          ) : (
            <p className="text-sm text-ink-faint">Ingen mätbar kostnad denna månad.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <FactChip title="Anrop som kostade och gick att prissätta">Betalda anrop · {month.scanner.pricedCalls + month.grading.pricedCalls}</FactChip>
            <FactChip tone="good" title="Bilden eller streckkoden avgjorde — inget vision-anrop">Gratis · {month.scanner.freeCalls}</FactChip>
            {month.totalUnmeasured > 0 && (
              <FactChip tone="warn" title="Rader utan tokental (före 2026-08-14 eller modell utan pris) — ingår INTE i beloppet">
                Omätta · {month.totalUnmeasured}
              </FactChip>
            )}
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Tokens in/ut: skanner {month.scanner.inputTokens.toLocaleString("sv-SE")} / {month.scanner.outputTokens.toLocaleString("sv-SE")} ·
            gradering {month.grading.inputTokens.toLocaleString("sv-SE")} / {month.grading.outputTokens.toLocaleString("sv-SE")}.
            Senaste {COST_WINDOW_DAYS} d: {formatCostOre(window.totalOre)}.
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Prenumeration</h3>
          {!pro ? (
            <p className="text-sm text-ink-muted">Gratiskonto — ingen betald eller gåvad Pro.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <FactChip tone="pro">Pro via {proSource}</FactChip>
              {renewal !== "none" && (
                <Badge variant={renewal === "yes" ? "success" : renewal === "no" ? "warning" : "default"} title={RENEWAL_LABELS[renewal].hint}>
                  {RENEWAL_LABELS[renewal].label}
                </Badge>
              )}
            </div>
          )}
          {(pro || user.proSince) && (
            <SubscriptionTimeline
              createdAt={user.createdAt}
              proSince={user.proSince}
              until={proUntil}
              untilLabel={renewal === "yes" ? "Förnyas" : "Löper ut"}
            />
          )}
          <details className="mt-3 text-xs text-ink-muted">
            <summary className="cursor-pointer select-none text-ink-faint hover:text-ink">Tekniska detaljer</summary>
            <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              <dt>planTier</dt><dd className="text-ink">{user.planTier}</dd>
              <dt>Gåva t.o.m.</dt><dd className="text-ink">{dt(user.bonusProUntil)}</dd>
              <dt>Stripe t.o.m.</dt><dd className="text-ink">{dt(user.stripeProUntil)}</dd>
              <dt>Stripe-kund</dt><dd className="truncate text-ink">{user.stripeCustomerId ?? "–"}</dd>
              <dt>Stripe-prenum.</dt><dd className="truncate text-ink">{user.stripeSubscriptionId ?? "–"}</dd>
              <dt>Prenumerant sedan</dt><dd className="text-ink">{dt(user.proSince)}</dd>
              <dt>App löper ut</dt><dd className="text-ink">{dt(user.rcExpiresAt)}</dd>
              <dt>Köpmiljö</dt><dd className="text-ink">{user.rcEnvironment ?? "–"}</dd>
              <dt>Rykte</dt><dd className="text-ink">{user.reputationScore}</dd>
              <dt>E-post bekräftad</dt><dd className="text-ink">{dt(user.emailVerifiedAt)}</dd>
              {user.pushTokens.map((t, i) => (
                <React.Fragment key={i}>
                  <dt>Enhet {i + 1}</dt><dd className="text-ink">{t.platform} · {formatDateTime(t.createdAt)}</dd>
                </React.Fragment>
              ))}
              {user.lastPushError && (<><dt>Push-fel</dt><dd className="text-fall">{user.lastPushError.slice(0, 120)}</dd></>)}
            </dl>
          </details>
        </Card>
      </div>

      {/* RAD 2: åtgärder · notiser */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Åtgärder</h3>
          <UserActions
            userId={user.id}
            name={user.name}
            role={user.role}
            planTier={user.planTier}
            bonusProUntil={user.bonusProUntil ? user.bonusProUntil.toISOString().slice(0, 10) : null}
            isPro={pro}
            isSelf={user.id === session.user.id}
            isSuperAdmin={hasRole(session.user.role, "SUPERADMIN")}
          />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Notiser</h3>
          <div className="flex flex-wrap gap-1.5">
            <ToggleChip label="E-post" on={notif.email} title="E-postnotiser (master — av ⇒ inget veckobrev heller)" />
            <ToggleChip label="Push" on={notif.push} />
            <ToggleChip label="Alla restocks" on={notif.allRestocks} title="Pro-opt-in: larm för vilken sealed-produkt som helst" />
            <ToggleChip label="Veckobrev" on={notif.weekly} />
            <ToggleChip label="Nyhetsmejl" on={notif.news} />
          </div>
        </Card>
      </div>

      {/* BEVAKAR */}
      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">Bevakar</h3>
          <span className="text-xs text-ink-muted">
            {activeWatches.length} aktiva · {user.watchlistItems.length - activeWatches.length} pausade
            {user.watchlistItems.length >= 100 && " · visar de 100 senaste"}
          </span>
        </div>
        {user.watchlistItems.length === 0 && user.setWatches.length === 0 ? (
          <p className="text-sm text-ink-faint">Bevakar ingenting.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <ul className="divide-y divide-surface-border/60">
              {user.watchlistItems.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <Link href={`/produkter/${w.product.slug}`} className="min-w-0 flex-1 truncate text-holo-cyan hover:opacity-80">
                    {w.product.title}
                  </Link>
                  <span className="tabular-nums text-ink-muted" title="Lägsta köpbara pris just nu">
                    {w.product.lowestPriceOre != null ? formatPrice(w.product.lowestPriceOre) : "–"}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {w.isPaused && <Badge variant="default">Pausad</Badge>}
                    {w.restockAlert && <Badge variant="info">Restock</Badge>}
                    {w.priceAlert && (
                      <Badge variant="success" title={w.targetPrice != null ? "Målpris" : "Prisfall"}>
                        {w.targetPrice != null ? `Mål ${formatPrice(w.targetPrice)}` : "Prisfall"}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-1 text-xs text-ink-muted">Bevakade set</p>
              {user.setWatches.length === 0 ? (
                <p className="text-sm text-ink-faint">–</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {user.setWatches.map((sw) => (
                    <li key={sw.set.id}>
                      <Link href={`/sets/${sw.set.id}`} className="text-holo-cyan hover:opacity-80">
                        {sw.set.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* AKTIVITET (livstid) som staplar */}
      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Aktivitet (livstid)</h3>
        <BarList
          rows={[
            { label: "Skanningar", value: user._count.scannerJobs },
            { label: "Graderingar", value: user._count.gradingJobs },
            { label: "Bevakningar", value: user._count.watchlistItems },
            { label: "Bevakade set", value: user._count.setWatches },
            { label: "Samling", value: user._count.collectionItems },
            { label: "Sålda", value: user._count.sales },
            { label: "Larm", value: user._count.alerts },
            { label: "Inlägg", value: user._count.posts },
            { label: "Kommentarer", value: user._count.comments },
            { label: "Inbjudningar", value: user._count.invitesSent },
          ]}
        />
      </Card>
    </div>
  );
}
