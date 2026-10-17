-- Vilken app kontot senast användes i ("ios" | "android"), skriven i jwt-callbacken ur appens
-- UA-tagg (lib/signup-platform.ts). Push-token var enda signalen förut, och Android har ingen push
-- förrän FCM finns — Android-användarna syntes därför aldrig i adminen. NULL = aldrig sedd i appen.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appPlatform" TEXT;

-- Backfill, starkast först: senaste kopplade appenhet (skannerns enhets-id, "and-…" = Android),
-- sedan plattformen kontot skapades i, sist en push-token (bara iOS har push). Idempotent.
UPDATE "User" u
SET "appPlatform" = CASE WHEN d.id LIKE 'and-%' THEN 'android' ELSE 'ios' END
FROM (
  SELECT DISTINCT ON ("userId") "userId", id
  FROM "GuestDevice"
  WHERE "userId" IS NOT NULL
  ORDER BY "userId", "createdAt" DESC
) d
WHERE d."userId" = u.id AND u."appPlatform" IS NULL;

UPDATE "User" SET "appPlatform" = "signupPlatform"
WHERE "appPlatform" IS NULL AND "signupPlatform" IN ('ios', 'android');

UPDATE "User" u SET "appPlatform" = lower(p.platform)
FROM (SELECT DISTINCT ON ("userId") "userId", platform FROM "PushToken" ORDER BY "userId", "createdAt" DESC) p
WHERE p."userId" = u.id AND u."appPlatform" IS NULL AND lower(p.platform) IN ('ios', 'android');
