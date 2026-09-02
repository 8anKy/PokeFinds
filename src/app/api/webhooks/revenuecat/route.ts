import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncDiscordRoles } from "@/services/discord-sync";
import {
  planChangesForEvent,
  subscriptionStatesForEvent,
  type Plan,
  type SubscriptionState,
} from "./mapping";

export const dynamic = "force-dynamic";

function msToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

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
  // Förnyelsestatus är en EGEN dom (mapping.ts): CANCELLATION rör inte planen
  // (access kvar till EXPIRATION) men MÅSTE skrivas — annars står en uppsagd
  // kund som prenumerant i adminen tills perioden tar slut.
  const states = subscriptionStatesForEvent(event);

  const perUser = new Map<string, { plan: Plan | null; state: SubscriptionState | null }>();
  for (const c of changes) perUser.set(c.userId, { plan: c.plan, state: null });
  for (const st of states) {
    const cur = perUser.get(st.userId);
    if (cur) cur.state = st;
    else perUser.set(st.userId, { plan: null, state: st });
  }

  for (const [userId, { plan, state }] of perUser) {
    // Läs föregående plan FÖRE skrivningen — annars går en nedgradering inte att
    // spåra i efterhand. 2026-07-08 satte en EXPIRATION ägarkontot till FREE utan
    // ett enda spår, och ALLA restock-larm dog tyst i fyra dygn. Nu loggas varje
    // plan-ändring som webhooken gör (även no-op) så det syns i AuditLog.
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { planTier: true, proSince: true },
    });
    if (!before) continue; // raderat konto, eller ett id som inte är vårt

    const environment =
      state?.environment ?? (typeof event?.environment === "string" ? event.environment : null);

    const data: Prisma.UserUpdateManyMutationInput = {};
    if (plan) data.planTier = plan;
    // null skriver ALDRIG över ett känt värde: ett BILLING_ISSUE säger inget om
    // förnyelsen och får inte radera att kunden faktiskt förnyas.
    if (state && state.willRenew !== null) data.rcWillRenew = state.willRenew;
    if (state?.expiresAt) data.rcExpiresAt = state.expiresAt;
    if (environment) data.rcEnvironment = environment;
    // "Prenumerant sedan" = första BETALDA aktiveringen. Sätts en gång, skrivs
    // aldrig över, och aldrig av ett SANDBOX-köp (en testare är inte en kund).
    if (
      plan === "PREMIUM" &&
      before.planTier !== "PREMIUM" &&
      !before.proSince &&
      environment !== "SANDBOX"
    ) {
      data.proSince = msToDate(event?.purchased_at_ms) ?? new Date();
    }

    // updateMany = ingen krasch om id:t inte finns (race mot kontoradering).
    await prisma.user.updateMany({ where: { id: userId }, data });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "user.plan.revenuecat",
        entityType: "User",
        entityId: userId,
        metadata: {
          event: eventType,
          from: before.planTier,
          to: plan ?? before.planTier,
          willRenew: state?.willRenew ?? null,
          expiresAt: state?.expiresAt?.toISOString() ?? null,
          eventId: typeof event?.id === "string" ? event.id : null,
          // Svarar på "betalade de på riktigt?" ur vår egen data (2026-08-30): tre
          // INITIAL_PURCHASE samma dag som en TestFlight-build gick ut syntes i
          // RevenueCat men aldrig hos Apple — sandbox-köp bär `environment: SANDBOX`
          // och provperioder `period_type: TRIAL/INTRO`, och ingetdera loggades.
          environment,
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
    // Pro-rollen i servern till nästa nattkörning. Kastar aldrig. Bara vid en
    // PLAN-ändring: en uppsägning ändrar ingen roll förrän den löper ut.
    if (plan) await syncDiscordRoles(userId, `Foilio: RevenueCat ${eventType}`);
  }

  return new Response("ok", { status: 200 });
}
