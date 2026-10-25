-- Pausa en set-bevakning utan att ta bort den (bevakningssidans Set-flik, 2026-10-25).
-- Idempotent: körs manuellt mot prod före deployen.
ALTER TABLE "SetWatch" ADD COLUMN IF NOT EXISTS "isPaused" BOOLEAN NOT NULL DEFAULT false;
