/**
 * Analystjänster. Händelser anonymiseras – användar-id:n lagras ALDRIG i metadata.
 */
import { prisma } from "@/lib/db";
import { payingUserWhere } from "@/lib/plan";

const FORBIDDEN_METADATA_KEYS = ["userId", "user_id", "email", "userEmail", "ip"];

/** Tar bort identifierande nycklar ur metadata innan lagring. */
function anonymizeMetadata(
  metadata?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * BUFFRAD SKRIVNING (2026-08-05) — kostnadskritiskt.
 *
 * Varje produktvisning skrev förut EN rad direkt. Sidorna som genererar dem är
 * fullt ISR-cachade (noll Neon-frågor för själva HTML:en), men spårningsanropet
 * väckte databasen ändå — så cachen sparade renderingen men inte NOTAN. Och notan
 * är nästan uteslutande VAKEN TID: Neon debiterar per CU-timme med ett minsta
 * fönster på 300 s per uppvaknande, så en ensam anonym besökare som bläddrar
 * igenom fem produkter kunde starta lika många fönster.
 *
 * Händelserna samlas därför i processminnet och skrivs med EN `createMany` när
 * antingen `FLUSH_SIZE` händelser samlats eller `FLUSH_MS` passerat — det som
 * inträffar först. N uppvaknanden blir ETT.
 *
 * ⛔ MEDVETEN AVVÄGNING: buffrade händelser som ännu inte skrivits FÖRSVINNER om
 * containern startas om (deploy, skalning, krasch). Det är accepterat — datat är
 * anonym engagemangsstatistik som matar topplistor och "Trendar", inte något som
 * påverkar priser, larm eller pengar. Ett tappat dussin visningar syns inte i en
 * 30-dagars aggregering; en skrivning per visning syns i fakturan.
 *
 * `createdAt` sätts vid KÖLÄGGNINGEN, inte vid tömningen — annars hade tidpunkten
 * blivit tömningens och dygns-/timaggregeringarna förskjutits med upp till en minut.
 * Händelsens form är i övrigt oförändrad (fortfarande ingen userId/IP, se ovan).
 */
type BufferedEvent = {
  eventType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

const FLUSH_SIZE = Number(process.env.ANALYTICS_FLUSH_SIZE ?? 50);
// 1 800 000 ms = 30 min. Låg på 300 000 (= exakt Neons minsta debiterade fönster)
// till 2026-08-29, och det talet var en tidsinställd bomb: varje tömning kan ARMA
// ett nytt 300-sekundersfönster, och med en tömning var 5:e minut kedjas fönstren
// ände-mot-ände så fort trafiken blir jämn — computen kan då matematiskt inte
// somna. MÄTT 2026-08-29 (7 dygn): 1 130 händelser spridda över 271 av 2 016
// femminutersluckor (13 %). Med 30 min per tömning halveras antalet luckor som
// spårningen ensam kan väcka. Priset är att "Trendar"/admin-engagemang släpar
// upp till 30 min — aggregeringarna är 7- och 30-dagars, ingen yta bryr sig.
// ⛔ Sänk aldrig under 300 000 igen (se ovan). FLUSH_SIZE-grenen skyddar mot en
// buffert som växer vid en skur.
const FLUSH_MS = Number(process.env.ANALYTICS_FLUSH_MS ?? 1_800_000);

let buffer: BufferedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let exitHooksInstalled = false;

/** Skriver ut och tömmer bufferten. Kastar aldrig — spårning får inte fälla något. */
export async function flushAnalyticsEvents(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  // Töm bufferten FÖRE skrivningen: annars samlar en långsam skrivning på sig
  // händelser som skrivs två gånger när nästa tömning kommer.
  const batch = buffer;
  buffer = [];
  try {
    await prisma.analyticsEvent.createMany({
      data: batch.map((e) => ({
        eventType: e.eventType,
        entityId: e.entityId,
        metadata: e.metadata as never,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    // Analytics får aldrig fälla huvudflödet. Batchen släpps (se avvägningen ovan)
    // — att lägga tillbaka den hade riskerat en buffert som växer i all oändlighet
    // när databasen är nere.
    console.error("Kunde inte spara analyshändelser:", error);
  }
}

function installExitHooks() {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  // Railway skickar SIGTERM vid deploy/omskalning → sista batchen hinner skrivas.
  const onExit = () => {
    void flushAnalyticsEvents();
  };
  process.once("beforeExit", onExit);
  process.once("SIGTERM", onExit);
  process.once("SIGINT", onExit);
}

export function trackEvent(
  eventType: string,
  entityId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  installExitHooks();
  buffer.push({
    eventType,
    entityId,
    metadata: anonymizeMetadata(metadata),
    createdAt: new Date(),
  });
  if (buffer.length >= FLUSH_SIZE) return flushAnalyticsEvents();
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flushAnalyticsEvents();
    }, FLUSH_MS);
    // Timern får inte hålla processen vid liv — annars kan en tom Node-process
    // inte avslutas, och `beforeExit` (som tömmer) fyras aldrig.
    flushTimer.unref?.();
  }
  // Returnerar ett löst löfte så att befintliga `await trackEvent(...)` fungerar
  // oförändrat: anroparen väntar inte längre på en DB-skrivning, bara på köläggningen.
  return Promise.resolve();
}

/** Adminstatistik: räkningar och senaste aktivitet. */
export async function getAdminStats() {
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);

  const [
    userCount,
    premiumCount,
    newUsers7d,
    productCount,
    offerCount,
    retailerCount,
    watchlistCount,
    alertCount24h,
    postCount,
    openReports,
    scrapeJobs24h,
    failedJobs24h,
    events24h,
  ] = await prisma.$transaction([
    prisma.user.count(),
    // BETALANDE kunder — EN definition, delad med adminöversikten.
    // ⛔ Låg som en egen `OR`-kopia här och räknade då med ägarens eget
    // PREMIUM-konto; se payingUserWhere() för varför staff aldrig får ingå.
    prisma.user.count({ where: payingUserWhere() }),
    prisma.user.count({ where: { createdAt: { gte: since7d } } }),
    prisma.product.count(),
    prisma.offer.count(),
    prisma.retailer.count(),
    prisma.watchlistItem.count(),
    prisma.alert.count({ where: { triggeredAt: { gte: since24h } } }),
    prisma.communityPost.count(),
    prisma.report.count({ where: { status: "OPEN" } }),
    prisma.scrapeJob.count({ where: { createdAt: { gte: since24h } } }),
    prisma.scrapeJob.count({
      where: { createdAt: { gte: since24h }, status: "FAILED" },
    }),
    prisma.analyticsEvent.count({ where: { createdAt: { gte: since24h } } }),
  ]);

  const [recentAuditLogs, topEvents] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.analyticsEvent.groupBy({
      by: ["eventType"],
      where: { createdAt: { gte: since7d } },
      _count: { eventType: true },
      orderBy: { _count: { eventType: "desc" } },
      take: 10,
    }),
  ]);

  return {
    users: { total: userCount, premium: premiumCount, new7d: newUsers7d },
    catalog: { products: productCount, offers: offerCount, retailers: retailerCount },
    engagement: {
      watchlistItems: watchlistCount,
      alerts24h: alertCount24h,
      posts: postCount,
      events24h,
    },
    moderation: { openReports },
    scraping: { jobs24h: scrapeJobs24h, failed24h: failedJobs24h },
    recentAuditLogs,
    topEvents: topEvents.map((e) => ({
      eventType: e.eventType,
      count: e._count.eventType,
    })),
  };
}

/** Skriver en granskningslogg för adminåtgärder. */
export async function writeAuditLog(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as never,
    },
  });
}
