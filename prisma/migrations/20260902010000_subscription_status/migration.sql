-- Prenumerationsstatus i admin: auto-förnyelse + "prenumerant sedan" (2026-09-02).
-- Idempotent (IF NOT EXISTS / IS NULL-vakter) — kan köras om utan skada.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCancelAtPeriodEnd" BOOLEAN;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "proSince" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rcWillRenew" BOOLEAN;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rcExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rcEnvironment" TEXT;

-- Bakfyllnad av "prenumerant sedan" ur AuditLog: första gången en webhook gav
-- kontot betald Pro. RevenueCat: to=PREMIUM som INTE är märkt SANDBOX (äldre rader
-- saknar miljö och räknas — de går inte att skilja). Stripe: första raden med ett
-- datum. Bara rader som saknar värde rörs.
UPDATE "User" u
SET "proSince" = f.first_paid
FROM (
  SELECT "userId", MIN("createdAt") AS first_paid
  FROM "AuditLog"
  WHERE (action = 'user.plan.revenuecat'
         AND metadata->>'to' = 'PREMIUM'
         AND COALESCE(metadata->>'environment', '') <> 'SANDBOX')
     OR (action = 'user.plan.stripe' AND metadata->>'to' IS NOT NULL)
  GROUP BY "userId"
) f
WHERE u.id = f."userId" AND u."proSince" IS NULL;

-- Senast kända köpmiljö per konto (loggas i AuditLog sedan 2026-08-30).
UPDATE "User" u
SET "rcEnvironment" = e.env
FROM (
  SELECT DISTINCT ON ("userId") "userId", metadata->>'environment' AS env
  FROM "AuditLog"
  WHERE action = 'user.plan.revenuecat' AND metadata->>'environment' IS NOT NULL
  ORDER BY "userId", "createdAt" DESC
) e
WHERE u.id = e."userId" AND u."rcEnvironment" IS NULL;
