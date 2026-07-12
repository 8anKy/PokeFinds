import { prisma } from "@/lib/db";
import { planForEvent } from "./mapping";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Verifiering = delad hemlig Authorization-header satt i RevenueCat-dashboarden.
  if (req.headers.get("authorization") !== process.env.REVENUECAT_WEBHOOK_AUTH) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event;
  const userId: unknown = event?.app_user_id;
  // RC anonyma id:n börjar med $RCAnonymousID — koppla aldrig dem till en user.
  if (typeof userId !== "string" || userId.startsWith("$RCAnonymousID")) {
    return new Response("ok", { status: 200 });
  }

  const eventType = String(event?.type);
  const plan = planForEvent(eventType);
  if (plan) {
    // Läs föregående plan FÖRE skrivningen — annars går en nedgradering inte att
    // spåra i efterhand. 2026-07-08 satte en EXPIRATION ägarkontot till FREE utan
    // ett enda spår, och ALLA restock-larm dog tyst i fyra dygn. Nu loggas varje
    // plan-ändring som webhooken gör (även no-op) så det syns i AuditLog.
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { planTier: true },
    });
    if (!before) return new Response("ok", { status: 200 }); // raderat konto

    // updateMany = ingen krasch om id:t inte finns (race mot kontoradering).
    await prisma.user.updateMany({ where: { id: userId }, data: { planTier: plan } });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "user.plan.revenuecat",
        entityType: "User",
        entityId: userId,
        metadata: {
          event: eventType,
          from: before.planTier,
          to: plan,
          eventId: typeof event?.id === "string" ? event.id : null,
        },
      },
    });
  }
  return new Response("ok", { status: 200 });
}
