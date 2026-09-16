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
  type FeatureCost,
} from "@/services/admin/user-costs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminRequired } from "../../admin-required";
import { LastSeen, PlanBadge, describeDevices, formatCostOre } from "../user-bits";
import { UserActions } from "../user-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Användare · Admin" };

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-surface-border/60 py-2 last:border-0">
      <span className="text-sm text-ink-muted" title={hint}>
        {label}
      </span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

const dash = <span className="text-ink-faint">–</span>;

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

/** En funktions kostnadsrad. Omätta rader står ALLTID bredvid beloppet. */
function FeatureBlock({
  title,
  monthly,
  window,
  windowDays,
  freeLabel,
}: {
  title: string;
  monthly: FeatureCost;
  window: FeatureCost;
  windowDays: number;
  /** Vad "gratis" betyder för just den här funktionen. */
  freeLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-surface-border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <span className="text-lg tabular-nums">{formatCostOre(monthly.costOre)}</span>
      </div>
      <p className="mb-3 text-xs text-ink-faint">
        Denna månad (samma fönster som kvoten). Senaste {windowDays} dygnen:{" "}
        {formatCostOre(window.costOre)}.
      </p>
      <Row label="Anrop denna månad" hint="Rader som kostade ett API-anrop och gick att prissätta">
        {monthly.pricedCalls}
      </Row>
      {freeLabel && (
        <Row label="Gratis" hint={freeLabel}>
          {monthly.freeCalls}
        </Row>
      )}
      <Row
        label="Omätta"
        hint="Rader utan tokental — skapade före kostnadsspårningen (2026-08-14) eller med en modell som saknar pris. Ingår INTE i beloppet."
      >
        {monthly.unmeasured > 0 ? (
          <span className="text-holo-gold">{monthly.unmeasured}</span>
        ) : (
          0
        )}
      </Row>
      <Row label="Tokens (in / ut)">
        {monthly.inputTokens.toLocaleString("sv-SE")} /{" "}
        {monthly.outputTokens.toLocaleString("sv-SE")}
      </Row>
      {monthly.unpricedModels.length > 0 && (
        <Row
          label="Saknar pris"
          hint="Lägg till modellen i MODEL_PRICES (src/lib/ai-pricing.ts) eller sätt AI_PRICE_OVERRIDES."
        >
          <span className="text-holo-gold">{monthly.unpricedModels.join(", ")}</span>
        </Row>
      )}
    </div>
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

  const activeWatches = user.watchlistItems.filter((w) => !w.isPaused);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            {user.name}
            <PlanBadge isPro={pro} planTier={user.planTier} />
            {user.role !== "USER" && <Badge variant="warning">{user.role}</Badge>}
          </h2>
          <p className="text-sm text-ink-muted">{user.email}</p>
        </div>
        <Link
          href="/admin/anvandare"
          className="text-sm text-holo-cyan transition-opacity hover:opacity-80"
        >
          ← Alla användare
        </Link>
      </div>

      {/* NYCKELTAL — det ögat ska fånga först. "Denna månad" = kvotens fönster. */}
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
        <StatTile label="Senast sedd" value={<LastSeen iso={user.lastSeenAt?.toISOString() ?? null} />} hint={`konto sedan ${user.createdAt.toISOString().slice(0, 10)}`} />
      </div>

      {/* ÅTGÄRDER — plan, Pro-gåva, roll. Flyttade hit från listan 2026-09-16. */}
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

      {/* BEVAKAR — vad kontot faktiskt väntar på. */}
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

      {/* KOSTNAD per funktion. */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Kostnad per funktion</h3>
          <span className="text-sm text-ink-muted">
            Totalt denna månad:{" "}
            <strong className="text-ink">{formatCostOre(month.totalOre)}</strong>
            {month.totalUnmeasured > 0 && (
              <span className="ml-1 text-holo-gold">
                (+{month.totalUnmeasured} omätta)
              </span>
            )}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FeatureBlock
            title="Kortskanning"
            monthly={month.scanner}
            window={window.scanner}
            windowDays={COST_WINDOW_DAYS}
            freeLabel="Bildmatchningen eller streckkoden avgjorde — inget vision-anrop gjordes."
          />
          <FeatureBlock
            title="AI-gradering"
            monthly={month.grading}
            window={window.grading}
            windowDays={COST_WINDOW_DAYS}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 font-medium">Utskickade larm (denna månad)</h3>
            <Row label="E-post" hint="Resend. Redovisas som antal — abonnemanget är fast, inte per mejl.">
              {month.emailAlerts}
            </Row>
            <Row label="Push" hint="APNs/FCM — kostar inget per utskick.">
              {month.pushAlerts}
            </Row>
          </div>
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 font-medium">Så räknas beloppet</h3>
            <p className="text-xs text-ink-faint">
              Leverantörens publicerade pris per miljon tokens × API:ts egna
              tokental för varje anrop. Ingen schablon. Rader utan tokental
              räknas som <strong>omätta</strong>, aldrig som noll kronor —
              spårningen startade 2026-08-14, så äldre aktivitet saknas.
              Infrastruktur (Neon, Railway, Resend) är delad och fördelas inte
              per användare.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Konto</h3>
          <Row label="Roll">{user.role}</Row>
          <Row label="Plan">
            <span className="flex items-center justify-end gap-2">
              {user.planTier}
              {pro && <Badge variant="info">Pro</Badge>}
            </span>
          </Row>
          <Row label="Gratis Pro t.o.m." hint="bonusProUntil — referral/kompensation">
            {user.bonusProUntil ? formatDateTime(user.bonusProUntil) : dash}
          </Row>
          <Row label="Stripe-Pro t.o.m." hint="stripeProUntil — webbabonnemang">
            {user.stripeProUntil ? formatDateTime(user.stripeProUntil) : dash}
          </Row>
          <Row label="Stripe-kund">{user.stripeCustomerId ?? dash}</Row>
          <Row label="Prenumeration">{user.stripeSubscriptionId ?? dash}</Row>
          <Row label="Prenumerant sedan" hint="proSince — första betalda aktiveringen (app eller Stripe), aldrig bonus/roll">
            {user.proSince ? formatDateTime(user.proSince) : dash}
          </Row>
          <Row
            label="Förnyas automatiskt"
            hint="Stripe: cancel_at_period_end · App: RevenueCat-status. Okänt = inget event sedan 2026-09-02."
          >
            <span title={RENEWAL_LABELS[renewalStatus(user)].hint}>{RENEWAL_LABELS[renewalStatus(user)].label}</span>
          </Row>
          <Row label="App-prenumeration löper ut" hint="rcExpiresAt — RevenueCats expiration_at_ms">
            {user.rcExpiresAt ? formatDateTime(user.rcExpiresAt) : dash}
          </Row>
          <Row label="Köpmiljö (RevenueCat)" hint="SANDBOX = testköp som Apple/Google aldrig debiterat">
            {user.rcEnvironment ?? dash}
          </Row>
          <Row label="E-post bekräftad">
            {user.emailVerifiedAt ? formatDateTime(user.emailVerifiedAt) : dash}
          </Row>
          <Row label="Onboarding klar">{user.onboardingCompleted ? "Ja" : "Nej"}</Row>
          <Row label="Publik samling">{user.isPublicCollection ? "Ja" : "Nej"}</Row>
          <Row label="Rykte">{user.reputationScore}</Row>
          <Row label="Skapad">{formatDateTime(user.createdAt)}</Row>
          <Row label="Senast sedd" hint="Senaste autentiserade aktivitet, uppdateras var 15:e minut">
            <LastSeen iso={user.lastSeenAt?.toISOString() ?? null} />
          </Row>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Notiser och enheter</h3>
          <Row label="E-postnotiser">{notif.email ? "På" : "Av"}</Row>
          <Row label="Push-notiser">{notif.push ? "På" : "Av"}</Row>
          <Row label="Alla restocks" hint="Pro-opt-in: larm för vilken sealed-produkt som helst">
            {notif.allRestocks ? "På" : "Av"}
          </Row>
          <Row
            label="Veckobrev"
            hint="Gäller alla konton, inte bara Pro. E-postnotiser är master — är den av går inget veckobrev ut heller."
          >
            {notif.weekly ? "På" : "Av"}
          </Row>
          <Row
            label="Appen installerad"
            hint="Bevisas av en registrerad push-token. Frånvaro bevisar inte motsatsen — appen kan vara installerad utan att push tillåtits."
          >
            {user.pushTokens.length > 0 ? (
              describeDevices(user.pushTokens.map((t) => t.platform))
            ) : (
              <span className="text-ink-faint">Ingen push-enhet registrerad</span>
            )}
          </Row>
          {user.pushTokens.map((t, i) => (
            <Row key={i} label={`Enhet ${i + 1} registrerad`}>
              {formatDateTime(t.createdAt)}
            </Row>
          ))}
          {user.lastPushError && (
            <Row label="Senaste push-fel">
              <span className="text-fall">{user.lastPushError.slice(0, 120)}</span>
            </Row>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Kopplingar</h3>
          <Row label="Discord">
            {user.discordUsername
              ? `${user.discordUsername} (${formatDateTime(user.discordLinkedAt)})`
              : dash}
          </Row>
          <Row label="Tradera">
            {user.traderaUserId
              ? `${user.traderaUserId}${
                  user.traderaTokenExpiresAt
                    ? ` · token t.o.m. ${formatDateTime(user.traderaTokenExpiresAt)}`
                    : ""
                }`
              : dash}
          </Row>
          <Row label="Kreatörskod" hint="Vilken kreatörslänk kontot skapades via">
            {user.creatorCode
              ? `${user.creatorCode.code} — ${user.creatorCode.creatorName}${
                  user.attributedAt ? ` (${formatDateTime(user.attributedAt)})` : ""
                }`
              : dash}
          </Row>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Aktivitet (livstid)</h3>
          <Row label="Bevakningar">{user._count.watchlistItems}</Row>
          <Row label="Bevakade set">{user._count.setWatches}</Row>
          <Row label="Objekt i samlingen">{user._count.collectionItems}</Row>
          <Row label="Sålda objekt">{user._count.sales}</Row>
          <Row label="Skanningar">{user._count.scannerJobs}</Row>
          <Row label="Graderingar">{user._count.gradingJobs}</Row>
          <Row label="Larm">{user._count.alerts}</Row>
          <Row label="Inlägg / kommentarer">
            {user._count.posts} / {user._count.comments}
          </Row>
          <Row label="Skickade inbjudningar">{user._count.invitesSent}</Row>
        </Card>
      </div>
    </div>
  );
}
