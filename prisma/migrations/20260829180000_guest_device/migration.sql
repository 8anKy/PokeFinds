-- Gästenhet: kortskanning utan konto i appen (2026-08-29). Se schema.prisma.
-- Idempotent: migrationerna måste tåla omkörning.
CREATE TABLE IF NOT EXISTS "GuestDevice" (
  "id" TEXT NOT NULL,
  "guestScans" INTEGER NOT NULL DEFAULT 0,
  "monthKey" TEXT,
  "monthScans" INTEGER NOT NULL DEFAULT 0,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestDevice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GuestDevice_userId_idx" ON "GuestDevice"("userId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GuestDevice_userId_fkey') THEN
    ALTER TABLE "GuestDevice" ADD CONSTRAINT "GuestDevice_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
