-- AlterTable
-- Idempotent: kolumnen lades till manuellt på prod under en incident (migrate
-- deploy timade ut på boot) → IF NOT EXISTS så omkörning på nästa deploy blir
-- en ren no-op och migrationen registreras som applicerad.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPushError" TEXT;
