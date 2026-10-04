CREATE TABLE IF NOT EXISTS "CommunityStoreReportConfirmation" (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityStoreReportConfirmation_pkey" PRIMARY KEY ("postId", "userId")
);
CREATE INDEX IF NOT EXISTS "CommunityStoreReportConfirmation_userId_idx" ON "CommunityStoreReportConfirmation"("userId");
DO $$ BEGIN
  ALTER TABLE "CommunityStoreReportConfirmation" ADD CONSTRAINT "CommunityStoreReportConfirmation_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "CommunityStoreReport"("postId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CommunityStoreReportConfirmation" ADD CONSTRAINT "CommunityStoreReportConfirmation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
