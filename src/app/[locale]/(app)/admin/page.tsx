import { prisma } from "@/lib/db";
import { isRedisAvailable } from "@/lib/queue";
import { formatRelative, formatDateTime, formatPrice } from "@/lib/format";
import { getAdminOverview, STORE_CUT } from "@/services/admin/overview";
import { getServiceCosts, type CostSource } from "@/services/admin/service-costs";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { JobStatus } from "@prisma/client";
import { PageBackButton } from "@/components/layout/page-back-button";
import { FunnelChart } from "@/components/features/admin/funnel-chart";
import { DonutChart, type DonutSlice } from "@/components/features/admin/donut-chart";
import { CATEGORICAL, EVENT_SERIES, seriesLabel } from "@/components/features/admin/chart-palette";
import {
  ActivityChartLazy,
  ScanChartLazy,
  UserGrowthChartLazy,
} from "@/components/features/admin/admin-charts-lazy";

export const dynamic = "force-dynamic";

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: "Köad",
  RUNNING: "Pågår",
  COMPLETED: "Slutförd",
  FAILED: "Misslyckad",
  CANCELLED: "Avbruten",
};

const JOB_STATUS_VARIANTS: Record<JobStatus, BadgeVariant> = {
  QUEUED: "default",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
};

function nf(value: number): string {
  return new Intl.NumberFormat("sv-SE").format(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)} %`;
}

/**
 * Nyckeltal. `tone` färgar BARA siffran, och bara när talet i sig är ett
 * tillstånd att reagera på — aldrig som dekoration.
 */
function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn";
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-ink-muted">{label}</p>
        <p
          className={
            "mt-1 font-display text-2xl font-bold " +
            (tone === "good" ? "text-rise" : tone === "warn" ? "text-holo-gold" : "text-ink")
          }
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** En rad "etikett … värde" i de smala korten. */
function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm text-ink-muted">
        {label}
        {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/**
 * ⛔ TRE UTFALL, ALDRIG TVÅ. En saknad nyckel är "vi vet inte", inte "0 kr" —
 * slås de ihop ser en dyr tjänst gratis ut. Felet visas med leverantörens egen
 * text: en tyst nolla är det farliga utfallet i en kostnadsvy.
 */
function SourceState({ source, envHint }: { source: CostSource<unknown>; envHint?: boolean }) {
  if (source.status === "ok") return null;
  if (source.status === "not_configured") {
    return (
      <p className="text-xs text-ink-faint">
        Ej konfigurerad — sätt <code className="text-ink-muted">{source.envVar}</code>.
        {envHint && <span className="block">{source.note}</span>}
      </p>
    );
  }
  return <p className="text-xs text-fall">Kunde inte hämtas: {source.message}</p>;
}

export default async function AdminOverviewPage() {
  const [overview, costs, observationCount, productsWithoutOffers, latestObservation, latestJob, catalog] =
    await Promise.all([
      getAdminOverview(),
      getServiceCosts(),
      prisma.priceObservation.count(),
      prisma.product.count({ where: { offers: { none: {} } } }),
      prisma.priceObservation.findFirst({
        orderBy: { observedAt: "desc" },
        select: { observedAt: true },
      }),
      prisma.scrapeJob.findFirst({
        orderBy: { createdAt: "desc" },
        include: { source: { select: { name: true } } },
      }),
      prisma.$transaction([
        prisma.product.count(),
        prisma.offer.count(),
        prisma.retailer.count(),
        prisma.scrapeJob.count({
          where: { createdAt: { gte: new Date(Date.now() - 864e5) } },
        }),
        prisma.scrapeJob.count({
          where: { createdAt: { gte: new Date(Date.now() - 864e5) }, status: "FAILED" },
        }),
      ]),
    ]);

  const [products, offers, retailers, jobs24h, failedJobs24h] = catalog;
  const { users, revenue, reach, invites, activity, funnel, series, payingUsers, planMix, eventMix } =
    overview;
  const redisOk = isRedisAvailable();
  const alertsPaused = restockAlertsPaused();

  /**
   * ⛔ DEN HÄR RADEN ÄR HELA POÄNGEN MED VYN. En betalande kund utan en enda
   * bevakning har köpt något hen inte använder — båda kunderna i augusti 2026 såg
   * ut exakt så, och ingen siffra i den gamla översikten visade det.
   */
  const payingWithoutWatch = payingUsers.filter((u) => u.watchlistCount === 0).length;

  // ── Ringdiagrammens data ────────────────────────────────────────────────
  // ⛔ Färg per NYCKEL ur den fasta ordningen, aldrig per index i en filtrerad
  //    lista — annars byter en kategori färg så fort en annan blir noll.
  const PLAN_COLORS: Record<string, string> = {
    paying: CATEGORICAL[0],
    bonus: CATEGORICAL[1],
    admin: CATEGORICAL[2],
    free: "#6b7280",
  };
  const planSlices: DonutSlice[] = planMix.map((p) => ({
    key: p.key,
    label: p.label,
    value: p.value,
    color: PLAN_COLORS[p.key] ?? "#6b7280",
  }));

  const eventSlices: DonutSlice[] = eventMix.map((e) => ({
    key: e.key,
    label: seriesLabel(e.key),
    value: e.value,
    color: EVENT_SERIES.find((s) => s.key === e.key)?.color ?? "#6b7280",
  }));

  /**
   * KOSTNADSRINGEN. ⛔ Bara poster vi HAR en siffra för får ligga i ringen — en
   * okonfigurerad tjänst är inte 0 kr och skulle göra "andel av totalen" till en
   * lögn. De saknade listas i stället under ringen.
   */
  const costSlices: DonutSlice[] = [];
  const missingCosts: { label: string; source: CostSource<unknown> }[] = [];
  const anthropicOre =
    costs.anthropic.status === "ok" ? costs.anthropic.data.costOre : null;
  // Anthropics FAKTISKA kostnad går före vår egen uträkning när båda finns —
  // fakturan är facit. Utan admin-nyckel används liggarens Anthropic-post.
  const ledgerAnthropic = costs.ledger.byProvider.find((b) => b.key === "anthropic");
  const ledgerGoogle = costs.ledger.byProvider.find((b) => b.key === "google");

  if (anthropicOre != null) {
    costSlices.push({
      key: "anthropic",
      label: "Anthropic (faktisk)",
      value: anthropicOre,
      color: CATEGORICAL[0],
      display: formatPrice(anthropicOre),
    });
  } else if (ledgerAnthropic && ledgerAnthropic.costOre > 0) {
    costSlices.push({
      key: "anthropic",
      label: "Anthropic (vår uträkning)",
      value: ledgerAnthropic.costOre,
      color: CATEGORICAL[0],
      display: formatPrice(ledgerAnthropic.costOre),
    });
  }
  if (ledgerGoogle && ledgerGoogle.costOre > 0) {
    costSlices.push({
      key: "google",
      label: "Google Gemini (vår uträkning)",
      value: ledgerGoogle.costOre,
      color: CATEGORICAL[1],
      display: formatPrice(ledgerGoogle.costOre),
    });
  }
  if (costs.neon.status === "ok") {
    costSlices.push({
      key: "neon",
      label: "Neon (beräknad)",
      value: costs.neon.data.costOre,
      color: CATEGORICAL[2],
      display: formatPrice(costs.neon.data.costOre),
    });
  } else {
    missingCosts.push({ label: "Neon", source: costs.neon });
  }
  if (costs.anthropic.status !== "ok") {
    missingCosts.push({ label: "Anthropic (faktisk kostnad)", source: costs.anthropic });
  }
  const costTotalOre = costSlices.reduce((sum, c) => sum + c.value, 0);

  return (
    <div className="space-y-6">
      <PageBackButton />

      {/* ── Nyckeltal ───────────────────────────────────────────────────── */}
      <section aria-label="Nyckeltal">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Användare"
            value={nf(users.total)}
            hint={`${nf(users.new7d)} nya senaste 7 dygnen · ${nf(users.new30d)} senaste 30`}
          />
          <StatCard
            label="Betalande"
            value={nf(revenue.paying)}
            hint={`${formatPrice(revenue.mrrOre)}/mån brutto · ${pct(revenue.conversion)} av alla konton`}
          />
          <StatCard
            label="Aktiva (7 dygn)"
            value={nf(users.active7d)}
            hint={`${nf(users.active30d)} senaste 30 dygnen · ${nf(users.neverSeen)} aldrig sedda`}
          />
          <StatCard
            label="Bevakar något"
            value={nf(reach.watchers)}
            tone={reach.watchers < users.total / 4 ? "warn" : undefined}
            hint={`${pct(users.total ? reach.watchers / users.total : 0)} av kontona · förutsättning för larm`}
          />
        </div>
      </section>

      {/* ── Tillväxt + tratt ────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kontotillväxt</CardTitle>
            <p className="text-sm text-ink-muted">
              Nya konton per dygn, eller totalen över tid. Håll muspekaren över en stapel.
            </p>
          </CardHeader>
          <CardContent>
            <UserGrowthChartLazy
              signups={series.signups}
              usersBeforeWindow={series.usersBeforeWindow}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Från konto till kund</CardTitle>
            <p className="text-sm text-ink-muted">
              Varje steg som andel av alla konton. Klicka på ett steg för förklaringen.
            </p>
          </CardHeader>
          <CardContent>
            <FunnelChart steps={funnel} />
          </CardContent>
        </Card>
      </div>

      {/* ── Aktivitet ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aktivitet per dygn</CardTitle>
            <p className="text-sm text-ink-muted">
              Anonyma händelser. Klicka i förklaringen för att filtrera en serie.
            </p>
          </CardHeader>
          <CardContent>
            <ActivityChartLazy events={series.events} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skanningar per dygn</CardTitle>
            <p className="text-sm text-ink-muted">
              Skannern är den funktion flest användare rör — bästa enskilda pulsmätaren.
            </p>
          </CardHeader>
          <CardContent>
            <ScanChartLazy scans={series.scans} />
          </CardContent>
        </Card>
      </div>

      {/* ── Fördelningar (ringar) ───────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kontofördelning</CardTitle>
            <p className="text-sm text-ink-muted">
              Varje konto tillhör exakt en grupp. Peka på ett segment för andelen.
            </p>
          </CardHeader>
          <CardContent>
            <DonutChart
              slices={planSlices}
              centerLabel="konton"
              centerValue={nf(users.total)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vad folk gör</CardTitle>
            <p className="text-sm text-ink-muted">
              Andel av alla händelser senaste 30 dygnen.
            </p>
          </CardHeader>
          <CardContent>
            <DonutChart
              slices={eventSlices}
              centerLabel="händelser"
              centerValue={nf(eventSlices.reduce((sum, e) => sum + e.value, 0))}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Kostnader ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Kostnader denna månad</CardTitle>
          <p className="text-sm text-ink-muted">
            Från och med den 1:a (UTC). AI-kostnaden räknas ur API:ernas egna
            tokental × leverantörens publicerade pris — samma uträkning som
            kostnaden per användare.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {costSlices.length > 0 ? (
            <DonutChart
              slices={costSlices}
              centerLabel="denna månad"
              centerValue={formatPrice(costTotalOre)}
            />
          ) : (
            <p className="text-sm text-ink-faint">Ingen mätbar kostnad ännu denna månad.</p>
          )}

          {/* ⛔ OMÄTT REDOVISAS ALLTID BREDVID BELOPPET. Rader utan tokental
              (allt före 2026-08-14, plus modeller utan pris) är inte gratis —
              de är okända, och utan raden ser notan lägre ut än den är. */}
          {(costs.ledger.totalUnmeasured > 0 || costs.ledger.unpricedModels.length > 0) && (
            <p className="text-xs text-holo-gold">
              {nf(costs.ledger.totalUnmeasured)} anrop är OMÄTTA (saknar tokental) och
              ingår inte i beloppet.
              {costs.ledger.unpricedModels.length > 0 && (
                <> Modeller utan pris: {costs.ledger.unpricedModels.join(", ")}.</>
              )}
            </p>
          )}

          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Per funktion
              </p>
              {costs.ledger.byFeature.length === 0 ? (
                <p className="text-sm text-ink-faint">Inga anrop ännu.</p>
              ) : (
                costs.ledger.byFeature.map((f) => (
                  <Row
                    key={f.key}
                    label={f.label}
                    value={formatPrice(f.costOre)}
                    hint={`${nf(f.calls)} anrop${f.unmeasured > 0 ? ` · ${nf(f.unmeasured)} omätta` : ""}`}
                  />
                ))
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Infrastruktur
              </p>
              {costs.neon.status === "ok" ? (
                <Row
                  label="Neon (compute)"
                  value={formatPrice(costs.neon.data.costOre)}
                  hint={`${costs.neon.data.computeUnitHours.toFixed(1)} CU-timmar × $${costs.neon.data.cuHourUsd}/CU-h — vår uträkning, inte Neons faktura`}
                />
              ) : (
                <div>
                  <p className="text-sm text-ink-muted">Neon</p>
                  <SourceState source={costs.neon} envHint />
                </div>
              )}
              {costs.anthropic.status === "ok" ? (
                <Row
                  label="Anthropic (faktisk)"
                  value={formatPrice(costs.anthropic.data.costOre)}
                  hint="Från Anthropics Admin-API — fakturan, inte vår uträkning"
                />
              ) : (
                <div>
                  <p className="text-sm text-ink-muted">Anthropic (faktisk kostnad)</p>
                  <SourceState source={costs.anthropic} envHint />
                </div>
              )}
              {/* ⛔ UTREDD OCH OMÖJLIG — öppna inte frågan igen utan ny information.
                  Se src/services/admin/service-costs.ts för källorna. */}
              <div>
                <p className="text-sm text-ink-muted">Kvarvarande krediter</p>
                <p className="text-xs text-ink-faint">
                  Finns inte att hämta: Anthropic har inget saldo-endpoint (bara
                  konsolen), och Gemini är ingen förbetald kreditprodukt utan
                  faktureras via Google Cloud.
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-muted">Railway</p>
                <p className="text-xs text-ink-faint">
                  Deras kostnadsfråga finns i schemat men inte i den publika
                  dokumentationen — läggs till när den introspekterats med en token.
                </p>
              </div>
            </div>
          </div>

          {missingCosts.length > 0 && (
            <p className="text-xs text-ink-faint">
              Ringen visar bara poster vi har en siffra för. Saknade:{" "}
              {missingCosts.map((m) => m.label).join(", ")} — de är inte 0 kr, de är okända.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Betalande ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Betalande kunder</CardTitle>
            <p className="text-sm text-ink-muted">
              planTier=PREMIUM (app) eller aktiv Stripe-prenumeration (webb). Admin och
              gratis Pro räknas inte.
            </p>
          </div>
          {payingWithoutWatch > 0 && (
            <Badge variant="warning">
              {payingWithoutWatch} utan bevakning
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Row label="Via App Store / Play" value={nf(revenue.payingStore)} />
            <Row label="Via Stripe (webb)" value={nf(revenue.payingStripe)} />
            <Row
              label="Brutto per månad"
              value={formatPrice(revenue.mrrOre)}
              hint={`${nf(revenue.paying)} × ${formatPrice(4900)}`}
            />
            <Row
              label="Efter butiksavdrag"
              value={formatPrice(revenue.mrrNetOre)}
              hint={`${Math.round(STORE_CUT * 100)} % på app-köp`}
            />
            <Row
              label="Gratis Pro (inbjudningar)"
              value={nf(revenue.bonusPro)}
              hint="Betalar inte"
            />
            <Row label="Admin med Pro" value={nf(revenue.adminPro)} hint="Betalar inte" />
          </div>

          {payingUsers.length === 0 ? (
            <p className="text-sm text-ink-faint">Inga betalande kunder ännu.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Kund</TH>
                    <TH>Kanal</TH>
                    <TH>Konto skapat</TH>
                    <TH className="text-right">Bevakningar</TH>
                    <TH className="text-right">Samling</TH>
                    <TH>Senast sedd</TH>
                  </TR>
                </THead>
                <TBody>
                  {payingUsers.map((u) => (
                    <TR key={u.id}>
                      <TD>
                        <Link
                          href={`/admin/anvandare/${u.id}`}
                          className="font-medium text-ink transition-colors hover:text-holo-cyan"
                        >
                          {u.name}
                        </Link>
                        <span className="block text-xs text-ink-faint">{u.email}</span>
                      </TD>
                      <TD>
                        <Badge variant={u.channel === "stripe" ? "info" : "default"}>
                          {u.channel === "stripe" ? "Stripe" : "App Store / Play"}
                        </Badge>
                      </TD>
                      <TD className="text-sm text-ink-muted">{formatDateTime(u.createdAt)}</TD>
                      <TD className="text-right">
                        {/* Noll bevakningar hos en betalande kund är ett larm, inte en siffra. */}
                        <span
                          className={
                            u.watchlistCount === 0
                              ? "font-semibold text-holo-gold"
                              : "text-ink"
                          }
                        >
                          {nf(u.watchlistCount)}
                        </span>
                      </TD>
                      <TD className="text-right text-ink">{nf(u.collectionCount)}</TD>
                      <TD className="text-sm text-ink-muted">
                        {u.lastSeenAt ? formatRelative(u.lastSeenAt) : "–"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Inbjudningar ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Inbjudningar</CardTitle>
          <p className="text-sm text-ink-muted">
            Tre verifierade inbjudningar ger inbjudaren en månad Pro. Koden förbrukas vid
            registrering — befintliga konton kan inte lösa in en.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Row label="Skapade koder" value={nf(invites.created)} />
            <Row label="Använda" value={nf(invites.used)} hint="Ledde till ett konto" />
            <Row
              label="Verifierade"
              value={nf(invites.verified)}
              hint="Den inbjudna bekräftade sin mejl"
            />
            <Row
              label="Belönade"
              value={nf(invites.rewarded)}
              hint="Fulla grupper om tre"
            />
          </div>

          {invites.edges.length === 0 ? (
            <p className="text-sm text-ink-faint">Ingen har skapat en inbjudan ännu.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Inbjudare</TH>
                    <TH>Inbjuden</TH>
                    <TH>Skapad</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {invites.edges.map((e) => (
                    <TR key={e.id}>
                      <TD>
                        <span className="font-medium text-ink">{e.inviterName}</span>
                        <span className="block text-xs text-ink-faint">{e.inviterEmail}</span>
                      </TD>
                      <TD>
                        {e.inviteeEmail ? (
                          <>
                            <span className="font-medium text-ink">{e.inviteeName}</span>
                            <span className="block text-xs text-ink-faint">{e.inviteeEmail}</span>
                          </>
                        ) : (
                          <span className="text-sm text-ink-faint">Ej inlöst</span>
                        )}
                      </TD>
                      <TD className="text-sm text-ink-muted">{formatDateTime(e.createdAt)}</TD>
                      <TD>
                        {e.rewardedAt ? (
                          <Badge variant="success">Belönad</Badge>
                        ) : e.verifiedAt ? (
                          <Badge variant="info">Verifierad</Badge>
                        ) : e.usedAt ? (
                          <Badge variant="warning">Väntar på verifiering</Badge>
                        ) : (
                          <Badge>Oanvänd</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Räckvidd + användning ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Räckvidd</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row
              label="E-postnotiser på"
              value={nf(reach.emailOn)}
              hint={`${pct(users.total ? reach.emailOn / users.total : 0)} av kontona`}
            />
            <Row label="Pushnotiser på" value={nf(reach.pushOn)} />
            <Row
              label="Appen installerad"
              value={nf(reach.appInstalled)}
              /* ⛔ En push-token BEVISAR appen. Frånvaro bevisar ingenting — en
                 användare kan ha appen och ha nekat push. */
              hint="Bevisat av en registrerad enhet"
            />
            <Row label="Discord kopplat" value={nf(reach.discordLinked)} />
            <Row
              label="Via kreatörskod"
              value={nf(reach.creatorAttributed)}
              hint="Konton skapade via en kreatörslänk"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Användning (30 dygn)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Skanningar" value={nf(activity.scannerJobs30d)} />
            <Row label="AI-graderingar" value={nf(activity.gradingJobs30d)} />
            <Row
              label="Larm skapade"
              value={nf(activity.alerts30d)}
              hint={alertsPaused ? "Restock-larm är PAUSADE" : undefined}
            />
            <Row label="Har skannat någon gång" value={nf(reach.scanners)} />
            <Row label="Har poster i samlingen" value={nf(reach.collectors)} />
            <Row
              label="Slutfört onboarding"
              value={nf(users.onboarded)}
              hint={`av ${nf(users.total)} konton`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Katalog</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Produkter" value={nf(products)} />
            <Row label="Erbjudanden" value={nf(offers)} hint={`${nf(retailers)} butiker`} />
            <Row label="Prisobservationer" value={nf(observationCount)} />
            <Row label="Produkter utan erbjudanden" value={nf(productsWithoutOffers)} />
            <Row
              label="Senaste prisobservation"
              value={
                latestObservation ? formatRelative(latestObservation.observedAt) : "Inga ännu"
              }
              hint={latestObservation ? formatDateTime(latestObservation.observedAt) : undefined}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Drift ───────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Systemstatus</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Databas</span>
              <Badge variant="success">OK</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Redis</span>
              {redisOk ? (
                <Badge variant="success">Ansluten</Badge>
              ) : (
                <Badge variant="warning">Ej tillgänglig (fallback aktiv)</Badge>
              )}
            </div>
            {/* Pausen syns i drift-kortet så den inte glöms bort. Den styr både
                larmen och copyn — se src/lib/restock-alerts-pause.ts. */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Restock-larm</span>
              {alertsPaused ? (
                <Badge variant="warning">Pausade</Badge>
              ) : (
                <Badge variant="success">Aktiva</Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-muted">Senaste scrapejobb</span>
              {latestJob ? (
                <span className="flex items-center gap-2 text-sm text-ink">
                  <span className="text-ink-muted">{latestJob.source.name}</span>
                  <Badge variant={JOB_STATUS_VARIANTS[latestJob.status]}>
                    {JOB_STATUS_LABELS[latestJob.status]}
                  </Badge>
                  <span className="text-xs text-ink-faint">
                    {formatRelative(latestJob.createdAt)}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-ink-faint">Inga jobb ännu</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Moderering och jobb</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Öppna rapporter" value={nf(activity.openReports)} />
            <Row label="Scrapejobb (24 h)" value={nf(jobs24h)} />
            <Row
              label="Misslyckade jobb (24 h)"
              value={nf(failedJobs24h)}
              hint={failedJobs24h > 0 ? "Kolla /admin/jobb" : undefined}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
