-- Stripe-betalning på webben. Egna kolumner vid sidan av planTier, som ägs av
-- RevenueCat-webhooken (dess EXPIRATION sätter FREE ovillkorligt och hade annars
-- kunnat säga upp en betalande webbkund). Samma mönster som bonusProUntil.
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeProUntil" TIMESTAMP(3);

-- Unikt: webhooken slår upp användaren på kundens id när prenumerationens
-- metadata saknas. Två konton på samma Stripe-kund vore ett tyst fel där en
-- betalning landar hos fel användare.
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
