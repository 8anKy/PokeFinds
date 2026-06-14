/**
 * Analystjänster. Händelser anonymiseras – användar-id:n lagras ALDRIG i metadata.
 */
import { prisma } from "@/lib/db";

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

export async function trackEvent(
  eventType: string,
  entityId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        eventType,
        entityId,
        metadata: anonymizeMetadata(metadata) as never,
      },
    });
  } catch (error) {
    // Analytics får aldrig fälla huvudflödet.
    console.error("Kunde inte spara analyshändelse:", error);
  }
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
    prisma.user.count({ where: { planTier: "PREMIUM" } }),
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
