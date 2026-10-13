-- Giveaway (2026-10-13): skanningens tillagda kort (ett jobb = ett kort) + anmälningar.
ALTER TABLE "ScannerJob" ADD COLUMN IF NOT EXISTS "addedCardId" TEXT;

CREATE TABLE IF NOT EXISTS "GiveawayEntry" (
    "id" TEXT NOT NULL,
    "giveaway" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tiktokHandle" TEXT,
    "instagramHandle" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GiveawayEntry_giveaway_userId_key" ON "GiveawayEntry"("giveaway", "userId");

DO $$ BEGIN
  ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
