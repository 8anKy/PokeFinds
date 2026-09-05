-- MODERATIONSLOGG + REGELVERSION (2026-09-05). Idempotent. ⛔ Körs i prod FÖRE push
-- (`node scripts/with-prod-db.mjs npx prisma migrate deploy`).

-- Vilken version av forumreglerna användaren godkände. Höjs FORUM_RULES_VERSION i
-- koden frågar dialogen igen. Befintliga godkännanden räknas som version 1.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "forumRulesVersion" INTEGER;
UPDATE "User" SET "forumRulesVersion" = 1
  WHERE "forumRulesAcceptedAt" IS NOT NULL AND "forumRulesVersion" IS NULL;

-- Blockerade försök (ordfiltret) per användare — en stoppad tråd lämnade inget
-- spår, så en återfallande användare var osynlig för moderatorerna.
CREATE TABLE IF NOT EXISTS "ModerationEvent" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "target"    TEXT NOT NULL,
  "detail"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ModerationEvent_userId_createdAt_idx" ON "ModerationEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ModerationEvent_createdAt_idx" ON "ModerationEvent"("createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ModerationEvent_userId_fkey') THEN
    ALTER TABLE "ModerationEvent"
      ADD CONSTRAINT "ModerationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
