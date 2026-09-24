ALTER TABLE "StripePromotionRedemption" ADD COLUMN "couponId" TEXT;
CREATE INDEX "StripePromotionRedemption_couponId_redeemedAt_idx" ON "StripePromotionRedemption"("couponId", "redeemedAt");
