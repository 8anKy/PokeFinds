-- Kreatörskoder (betalda TikTok-samarbeten). Koden gör två oberoende saker:
-- attribution av NYA KONTON (?ref= → cookie → User.creatorCodeId, oavsett köp och
-- plattform) och rabatt i webbkassan via ett Stripe promotion code. Se schema.prisma.
--
-- IF NOT EXISTS överallt: migrationen ska tåla omkörning (Dockerfilens
-- `migrate deploy || true` är icke-blockerande och kan köras om vid nästa boot).
CREATE TABLE IF NOT EXISTS "CreatorCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "channel" TEXT,
    "note" TEXT,
    "stripePromotionCodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorCode_pkey" PRIMARY KEY ("id")
);

-- Koden lagras kanoniskt (VERSALER) av applikationen — unikheten förutsätter det.
CREATE UNIQUE INDEX IF NOT EXISTS "CreatorCode_code_key" ON "CreatorCode"("code");
CREATE INDEX IF NOT EXISTS "CreatorCode_isActive_idx" ON "CreatorCode"("isActive");

-- Attributionen på användaren. NULL = organiskt konto (merparten).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creatorCodeId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "attributedAt" TIMESTAMP(3);

-- Adminvyn räknar konton per kod.
CREATE INDEX IF NOT EXISTS "User_creatorCodeId_idx" ON "User"("creatorCodeId");

-- SET NULL, inte CASCADE: raderas en kod ska användaren finnas kvar. En felraderad
-- kod får kosta oss statistiken, aldrig kontot.
DO $$ BEGIN
    ALTER TABLE "User" ADD CONSTRAINT "User_creatorCodeId_fkey"
        FOREIGN KEY ("creatorCodeId") REFERENCES "CreatorCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
