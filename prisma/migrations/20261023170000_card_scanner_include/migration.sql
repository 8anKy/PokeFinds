-- Unika Cardmarket-only-kort som skannern får känna igen (2026-10-23). Sätts av
-- scripts/build-scanner-unique-cards.ts; false = cm:-kortet hålls utanför indexet som förut.
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "scannerInclude" BOOLEAN NOT NULL DEFAULT false;
