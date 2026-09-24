import { prisma } from "@/lib/db";
import { PROMOTION_REDEMPTIONS_PAGE_SIZE } from "@/lib/stripe-promotion";

export async function getStripePromotionRedemptions(page: number, query: string) {
  const code = query.trim().slice(0, 80);
  const where = code
    ? {
        OR: [
          { code: { contains: code, mode: "insensitive" as const } },
          { promotionCodeId: { contains: code, mode: "insensitive" as const } },
          { couponId: { contains: code, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.stripePromotionRedemption.count({ where }),
    prisma.stripePromotionRedemption.findMany({
      where,
      orderBy: [{ redeemedAt: "desc" }, { checkoutSessionId: "desc" }, { promotionCodeId: "desc" }],
      skip: (page - 1) * PROMOTION_REDEMPTIONS_PAGE_SIZE,
      take: PROMOTION_REDEMPTIONS_PAGE_SIZE,
      select: {
        checkoutSessionId: true,
        promotionCodeId: true,
        couponId: true,
        code: true,
        checkoutName: true,
        redeemedAt: true,
        livemode: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return { rows, total, page, query: code };
}

export type StripePromotionRedemptions = Awaited<ReturnType<typeof getStripePromotionRedemptions>>;
