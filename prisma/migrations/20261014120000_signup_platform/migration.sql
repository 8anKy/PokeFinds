-- Var kontot skapades (iOS-app / Android-app / webb). Sätts vid skapandet från 2026-10-14.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "signupPlatform" TEXT;

-- Backfill: konton med en appenhet (skannern skickar enhets-id:t) får enhetens plattform —
-- den FÖRSTA kopplade enheten. Android-id:n börjar med "and-", iOS är en UUID. Övriga förblir NULL
-- (webb eller app utan skanning — går inte att skilja i efterhand). Idempotent.
UPDATE "User" u
SET "signupPlatform" = CASE WHEN d.id LIKE 'and-%' THEN 'android' ELSE 'ios' END
FROM (
  SELECT DISTINCT ON ("userId") "userId", id
  FROM "GuestDevice"
  WHERE "userId" IS NOT NULL
  ORDER BY "userId", "createdAt"
) d
WHERE d."userId" = u.id AND u."signupPlatform" IS NULL;
