import type Stripe from "stripe";
import { prisma, withDbRetry } from "@/lib/db";
import { checkoutPromotionCodeIds } from "@/lib/stripe-promotion";

/**
 * Sparar faktisk kodanvändning vid ett slutfört Stripe Checkout.
 * ⛔ CreatorCode.user-attribution är INTE samma sak: en befintlig användare kan
 * skriva in en partnerkod utan att någonsin ha besökt en kreatörslänk.
 */
export async function recordCheckoutPromotionRedemptions(
  stripe: Stripe,
  checkoutSessionId: string,
  subscriptionId: string,
  userId: string,
  redeemedAt: Date,
): Promise<void> {
  // ⛔ Läs den FÄRSKA sessionen. Webhooken kan återförsöka ett äldre event, och
  // eventets inbäddade objekt behöver inte bära rabatterna i den form vi väntar oss.
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const sessionSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (sessionSubscriptionId !== subscriptionId) {
    throw new Error(`[stripe] checkout ${checkoutSessionId} hör inte till prenumeration ${subscriptionId}`);
  }

  const promotionCodeIds = checkoutPromotionCodeIds(session);
  if (promotionCodeIds.length === 0) return;

  const promotionCodes = await Promise.all(
    promotionCodeIds.map((id) => stripe.promotionCodes.retrieve(id)),
  );

  await withDbRetry(() =>
    prisma.stripePromotionRedemption.createMany({
      data: promotionCodes.map((promotion) => ({
        checkoutSessionId,
        promotionCodeId: promotion.id,
        couponId: typeof promotion.promotion.coupon === "string"
          ? promotion.promotion.coupon
          : promotion.promotion.coupon?.id ?? null,
        userId,
        code: promotion.code,
        checkoutName: session.customer_details?.name?.trim() || null,
        redeemedAt,
        livemode: session.livemode,
      })),
      // Stripe skickar webhooks minst en gång och kan återförsöka efter en
      // tillfällig DB-störning. Den sammansatta primärnyckeln är dubblettspärren.
      skipDuplicates: true,
    }),
  );
}
