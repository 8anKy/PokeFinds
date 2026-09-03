-- BEVAKADE LÄNKAR (2026-09-04): butiks-URL:er vi frågar DIREKT för att ingen feed
-- nämner dem. Bakgrund i modellens doc-kommentar (prisma/schema.prisma) och i
-- src/scrapers/watched-listing.ts. Idempotent (IF NOT EXISTS / DO-vakter) — kan
-- köras om utan skada. ⛔ Migrationen MÅSTE ligga före koden i prod
-- (`node scripts/with-prod-db.mjs npx prisma migrate deploy` FÖRE push).

CREATE TABLE IF NOT EXISTS "WatchedListing" (
  "id"            TEXT NOT NULL,
  "retailerId"    TEXT NOT NULL,
  "url"           TEXT NOT NULL,
  "note"          TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "addedById"     TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "lastStatus"    "StockStatus" NOT NULL DEFAULT 'UNKNOWN',
  "lastPriceOre"  INTEGER,
  "lastTitle"     TEXT,
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WatchedListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WatchedListing_retailerId_url_key" ON "WatchedListing"("retailerId", "url");
CREATE INDEX IF NOT EXISTS "WatchedListing_isActive_idx" ON "WatchedListing"("isActive");

-- Butiken raderas ⇒ dess bevakningar följer med (Cascade). Admin raderas ⇒ bevakningen
-- blir kvar utan avsändare (SetNull) — instruktionen är kvar även om personen slutar.
DO $$ BEGIN
  ALTER TABLE "WatchedListing"
    ADD CONSTRAINT "WatchedListing_retailerId_fkey"
    FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WatchedListing"
    ADD CONSTRAINT "WatchedListing_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
