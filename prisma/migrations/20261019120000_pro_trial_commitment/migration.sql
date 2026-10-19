-- Provperiod (14 dagar på 12-månadersplanen) + webbens bindningstid. Idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialSource" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialProductId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialValueSentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialReminderSentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCommitmentEndsAt" TIMESTAMP(3);
