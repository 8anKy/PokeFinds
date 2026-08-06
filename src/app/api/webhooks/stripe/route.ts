import type Stripe from "stripe";
import { prisma, withDbRetry } from "@/lib/db";
import { getStripe, stripeEnabled, subscriptionPeriodEnd } from "@/lib/stripe";
import { HANDLED_EVENTS, proUntilForSubscription } from "./mapping";

export const dynamic = "force-dynamic";

/**
 * Stripe-webhooken — enda vägen in för webbens Pro.
 *
 * Speglar revenuecat/route.ts: verifiera avsändaren, skriv planen, logga ÄNDRINGEN
 * i AuditLog. Loggen är inte pynt — 2026-07-08 satte en EXPIRATION ägarkontot till
 * FREE utan ett enda spår och alla larm dog tyst i fyra dygn. En plan som ändras
 * utan att det syns är samma fälla oavsett vilken leverantör som ändrar den.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeEnabled() || !secret) {
    // Avstängd betalning ska inte se ut som ett fel för Stripe (som då gör om
    // försöket i tre dygn). 200 = "mottaget, vi gör inget".
    return new Response("stripe disabled", { status: 200 });
  }

  // ⛔ RÅ kropp. `req.json()` går inte att använda här: signaturen räknas över
  // exakt de bytes Stripe skickade, och en omserialisering ändrar dem.
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    // 400 (inte 500): en ogiltig signatur blir aldrig giltig, så Stripe ska
    // INTE göra om försöket.
    console.error("[stripe] ogiltig webhook-signatur:", err);
    return new Response("invalid signature", { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) return new Response("ok", { status: 200 });

  try {
    await handleEvent(stripe, event);
  } catch (err) {
    // 500 → Stripe gör om försöket. Ett tappat event är en kund som betalat men
    // inte fått sitt Pro, så en tyst 200 vore det värsta svaret här.
    console.error(`[stripe] kunde inte hantera ${event.type}:`, err);
    return new Response("handler error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}

async function handleEvent(stripe: Stripe, event: Stripe.Event) {
  const { subscriptionId, fallbackUserId } = extractSubscription(event);
  if (!subscriptionId) return;

  // Färsk hämtning, aldrig eventets egen ögonblicksbild — se HANDLED_EVENTS.
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const userId =
    (typeof sub.metadata?.userId === "string" ? sub.metadata.userId : null) ??
    fallbackUserId ??
    (await userIdForCustomer(sub.customer));
  if (!userId) {
    // Ingen koppling till ett konto → logga och släpp igenom. Att kasta hade
    // fått Stripe att göra om försöket i tre dygn för något som aldrig löser sig.
    console.error(`[stripe] prenumeration ${sub.id} utan känd användare`);
    return;
  }

  const proUntil = proUntilForSubscription(sub.status, subscriptionPeriodEnd(sub));
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  await withDbRetry(async () => {
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeProUntil: true },
    });
    if (!before) return; // raderat konto — samma hantering som RC-webhooken

    await prisma.user.updateMany({
      where: { id: userId },
      data: {
        stripeProUntil: proUntil,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "user.plan.stripe",
        entityType: "User",
        entityId: userId,
        metadata: {
          event: event.type,
          status: sub.status,
          from: before.stripeProUntil?.toISOString() ?? null,
          to: proUntil?.toISOString() ?? null,
          subscriptionId: sub.id,
          eventId: event.id,
        },
      },
    });
  });
}

/**
 * Vilken prenumeration eventet handlar om. `checkout.session.completed` bär
 * dessutom `client_reference_id` — det är den ENDA punkten där kopplingen
 * konto↔Stripe-kund uppstår första gången, innan någon `stripeCustomerId` finns
 * sparad att slå upp på.
 */
function extractSubscription(event: Stripe.Event): {
  subscriptionId: string | null;
  fallbackUserId: string | null;
} {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const sub = session.subscription;
    return {
      subscriptionId: typeof sub === "string" ? sub : sub?.id ?? null,
      fallbackUserId:
        session.client_reference_id ??
        (typeof session.metadata?.userId === "string" ? session.metadata.userId : null),
    };
  }
  const sub = event.data.object as Stripe.Subscription;
  return { subscriptionId: sub.id, fallbackUserId: null };
}

async function userIdForCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
): Promise<string | null> {
  const id = typeof customer === "string" ? customer : customer.id;
  const user = await withDbRetry(() =>
    prisma.user.findUnique({ where: { stripeCustomerId: id }, select: { id: true } })
  );
  return user?.id ?? null;
}
