import type Stripe from "stripe";

export const PROMOTION_REDEMPTIONS_PAGE_SIZE = 30;

/** Promotion codes som faktiskt sitter på den slutförda Checkout-sessionen. */
export function checkoutPromotionCodeIds(session: Stripe.Checkout.Session): string[] {
  if (session.mode !== "subscription" || session.status !== "complete") return [];
  return [...new Set(
    (session.discounts ?? [])
      .map((discount) => discount.promotion_code)
      .filter((code): code is string | Stripe.PromotionCode => code !== null)
      .map((code) => typeof code === "string" ? code : code.id),
  )];
}
