import { prisma } from "@/lib/db";
import { syncDiscordRoles } from "@/services/discord-sync";
import { planChangesForEvent } from "./mapping";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Verifiering = delad hemlig Authorization-header satt i RevenueCat-dashboarden.
  if (req.headers.get("authorization") !== process.env.REVENUECAT_WEBHOOK_AUTH) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event;
  const eventType = String(event?.type);

  // ⛔ ETT EVENT KAN RÖRA FLERA ANVÄNDARE. TRANSFER bär ingen `app_user_id` alls
  // utan `transferred_to`/`transferred_from` — se mapping.ts. Den gamla koden
  // läste bara `app_user_id` och svarade tyst 200 på varje transfer.
  const changes = planChangesForEvent(event);

  for (const { userId, plan } of changes) {
    // Läs föregående plan FÖRE skrivningen — annars går en nedgradering inte att
    // spåra i efterhand. 2026-07-08 satte en EXPIRATION ägarkontot till FREE utan
    // ett enda spår, och ALLA restock-larm dog tyst i fyra dygn. Nu loggas varje
    // plan-ändring som webhooken gör (även no-op) så det syns i AuditLog.
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { planTier: true },
    });
    if (!before) continue; // raderat konto, eller ett id som inte är vårt

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
          // Svarar på "betalade de på riktigt?" ur vår egen data (2026-08-30): tre
          // INITIAL_PURCHASE samma dag som en TestFlight-build gick ut syntes i
          // RevenueCat men aldrig hos Apple — sandbox-köp bär `environment: SANDBOX`
          // och provperioder `period_type: TRIAL/INTRO`, och ingetdera loggades.
          environment: typeof event?.environment === "string" ? event.environment : null,
          periodType: typeof event?.period_type === "string" ? event.period_type : null,
          store: typeof event?.store === "string" ? event.store : null,
          productId: typeof event?.product_id === "string" ? event.product_id : null,
          price: typeof event?.price === "number" ? event.price : null,
          currency: typeof event?.currency === "string" ? event.currency : null,
        },
      },
    });

    // Discord-rollen följer planen. Särskilt viktigt för EXPIRATION, som sätter
    // FREE ovillkorligt — utan det här hade en utgången app-prenumeration behållit
    // Pro-rollen i servern till nästa nattkörning. Kastar aldrig.
    await syncDiscordRoles(userId, `Foilio: RevenueCat ${eventType}`);
  }

  return new Response("ok", { status: 200 });
}
