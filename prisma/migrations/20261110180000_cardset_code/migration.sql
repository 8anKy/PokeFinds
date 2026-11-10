-- One Piece-matchningen (2026-11-10): utgivarens setkod ("OP-09", "EB-03", "ST32"). Additivt, idempotent.
ALTER TABLE "CardSet" ADD COLUMN IF NOT EXISTS "code" TEXT;
