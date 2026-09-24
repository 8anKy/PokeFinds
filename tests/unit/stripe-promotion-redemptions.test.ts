import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutPromotionCodeIds } from "@/lib/stripe-promotion";

const { createMany } = vi.hoisted(() => ({ createMany: vi.fn().mockResolvedValue({ count: 1 }) }));

vi.mock("@/lib/db", () => ({
  prisma: { stripePromotionRedemption: { createMany } },
  withDbRetry: (operation: () => Promise<unknown>) => operation(),
}));

import { recordCheckoutPromotionRedemptions } from "@/services/stripe-promotion-redemptions";

function checkout(overrides: object = {}): Stripe.Checkout.Session {
  return {
    id: "cs_partner",
    mode: "subscription",
    status: "complete",
    subscription: "sub_partner",
    livemode: true,
    customer_details: { name: "Ada Lovelace" },
    discounts: [{ coupon: null, promotion_code: "promo_cardshop" }],
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe("checkoutPromotionCodeIds", () => {
  it("tar bara unika promotion codes ur ett slutfört abonnemangsköp", () => {
    expect(checkoutPromotionCodeIds(checkout({
      discounts: [
        { coupon: null, promotion_code: "promo_cardshop" },
        { coupon: null, promotion_code: "promo_cardshop" },
        { coupon: "coupon_direct", promotion_code: null },
      ],
    }))).toEqual(["promo_cardshop"]);
  });

  it("räknar inte ett avbrutet Checkout som en inlösning", () => {
    expect(checkoutPromotionCodeIds(checkout({ status: "open" }))).toEqual([]);
  });
});

describe("recordCheckoutPromotionRedemptions", () => {
  beforeEach(() => createMany.mockClear());

  it("sparar namngiven kodanvändning med dubblettspärr, oberoende av kreatörslänkar", async () => {
    const retrieveSession = vi.fn().mockResolvedValue(checkout());
    const retrievePromotion = vi.fn().mockResolvedValue({ id: "promo_cardshop", code: "CARD SHOP", promotion: { type: "coupon", coupon: "coupon_cardshop" } });
    const stripe = {
      checkout: { sessions: { retrieve: retrieveSession } },
      promotionCodes: { retrieve: retrievePromotion },
    } as unknown as Stripe;
    const redeemedAt = new Date("2026-09-24T18:00:00Z");

    await recordCheckoutPromotionRedemptions(
      stripe, "cs_partner", "sub_partner", "user_1", redeemedAt,
    );

    expect(retrievePromotion).toHaveBeenCalledWith("promo_cardshop");
    expect(createMany).toHaveBeenCalledWith({
      data: [{
        checkoutSessionId: "cs_partner",
        promotionCodeId: "promo_cardshop",
        couponId: "coupon_cardshop",
        userId: "user_1",
        code: "CARD SHOP",
        checkoutName: "Ada Lovelace",
        redeemedAt,
        livemode: true,
      }],
      skipDuplicates: true,
    });
  });

  it("skriver inget när Checkout saknar promotion code", async () => {
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(checkout({ discounts: [] })) } },
      promotionCodes: { retrieve: vi.fn() },
    } as unknown as Stripe;
    await recordCheckoutPromotionRedemptions(stripe, "cs_partner", "sub_partner", "user_1", new Date());
    expect(createMany).not.toHaveBeenCalled();
  });

  it("vägrar koppla en främmande Checkout-session till användaren", async () => {
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(checkout({ subscription: "sub_other" })) } },
      promotionCodes: { retrieve: vi.fn() },
    } as unknown as Stripe;
    await expect(recordCheckoutPromotionRedemptions(
      stripe, "cs_partner", "sub_partner", "user_1", new Date(),
    )).rejects.toThrow("hör inte till prenumeration");
    expect(createMany).not.toHaveBeenCalled();
  });
});
