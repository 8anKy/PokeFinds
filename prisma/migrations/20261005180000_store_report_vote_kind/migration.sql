-- En medlems röst på en butiksrapport: CONFIRM = "stämmer fortfarande",
-- DISPUTE = "inte längre" (finns inte kvar / finns igen). En rad per (rapport, medlem).
ALTER TABLE "CommunityStoreReportConfirmation" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'CONFIRM';
DO $$ BEGIN
  ALTER TABLE "CommunityStoreReportConfirmation"
    ADD CONSTRAINT "CommunityStoreReportConfirmation_kind_check" CHECK ("kind" IN ('CONFIRM', 'DISPUTE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
