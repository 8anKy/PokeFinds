-- Google-/Apple-inloggning (2026-08-29).
--   passwordHash blir NULLABLE: ett konto skapat via Google/Apple har inget
--   lösenord. Lösenordsvägen i lib/auth.ts nekar explicit när kolumnen är NULL.
--   googleId / appleId = leverantörens stabila `sub` ur id_token, unika.
-- Idempotent: migrationerna måste tåla omkörning (advisory-låset kan slå till).
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_appleId_key" ON "User"("appleId");
