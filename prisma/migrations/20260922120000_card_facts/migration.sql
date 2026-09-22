-- Kortfakta för produktsidans "Om kortet"-panel (2026-09-22). Idempotent.
ALTER TABLE "Card"
  ADD COLUMN IF NOT EXISTS "types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "weaknessType" TEXT,
  ADD COLUMN IF NOT EXISTS "weaknessValue" TEXT,
  ADD COLUMN IF NOT EXISTS "retreatCost" INTEGER,
  ADD COLUMN IF NOT EXISTS "regulationMark" TEXT,
  ADD COLUMN IF NOT EXISTS "dexId" INTEGER,
  ADD COLUMN IF NOT EXISTS "flavorText" TEXT,
  ADD COLUMN IF NOT EXISTS "factsCheckedAt" TIMESTAMP(3);
