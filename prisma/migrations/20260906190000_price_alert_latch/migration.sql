-- Prislarmets spärr (latch) + ett pris per larm. Idempotent (IF NOT EXISTS) —
-- migrationerna körs om vid advisory-låstimeout, se CLAUDE.md.
ALTER TABLE "WatchlistItem"
  ADD COLUMN IF NOT EXISTS "priceAlertFiredOre" INTEGER,
  ADD COLUMN IF NOT EXISTS "priceAlertFiredAt" TIMESTAMP(3);

ALTER TABLE "Alert"
  ADD COLUMN IF NOT EXISTS "priceOre" INTEGER;
