-- Veckoserien: en rad per användare och svensk kalenderdag med en handling.
CREATE TABLE IF NOT EXISTS "ActivityDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityDay_pkey" PRIMARY KEY ("userId", "day")
);

DO $$ BEGIN
  ALTER TABLE "ActivityDay" ADD CONSTRAINT "ActivityDay_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Engångsfyllning ur handlingar som redan finns (5 veckor bakåt) så serien inte börjar på noll
-- vid lanseringen. Samma regel som i appen: svensk kalenderdag ur serverns tidsstämpel.
INSERT INTO "ActivityDay" ("userId", "day")
SELECT DISTINCT "userId", ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date
FROM (
  SELECT "userId", "createdAt" FROM "ScannerJob" WHERE "status" <> 'FAILED'
  UNION ALL SELECT "userId", "createdAt" FROM "CollectionItem"
  UNION ALL SELECT "userId", "createdAt" FROM "WatchlistItem"
  UNION ALL SELECT "userId", "createdAt" FROM "SetWatch"
  UNION ALL SELECT "userId", "createdAt" FROM "CommunityPost"
  UNION ALL SELECT "userId", "createdAt" FROM "Comment"
  UNION ALL SELECT "userId", "createdAt" FROM "GradingJob" WHERE "status" <> 'FAILED'
) a
WHERE "userId" IS NOT NULL AND "createdAt" >= TIMESTAMP '2026-09-14 00:00:00'
ON CONFLICT DO NOTHING;
