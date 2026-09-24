CREATE TABLE "StripePromotionRedemption" (
    "checkoutSessionId" TEXT NOT NULL,
    "promotionCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL,
    "livemode" BOOLEAN NOT NULL,

    CONSTRAINT "StripePromotionRedemption_pkey" PRIMARY KEY ("checkoutSessionId","promotionCodeId")
);

CREATE INDEX "StripePromotionRedemption_redeemedAt_idx" ON "StripePromotionRedemption"("redeemedAt");
CREATE INDEX "StripePromotionRedemption_code_redeemedAt_idx" ON "StripePromotionRedemption"("code","redeemedAt");
CREATE INDEX "StripePromotionRedemption_userId_redeemedAt_idx" ON "StripePromotionRedemption"("userId","redeemedAt");

ALTER TABLE "StripePromotionRedemption" ADD CONSTRAINT "StripePromotionRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
