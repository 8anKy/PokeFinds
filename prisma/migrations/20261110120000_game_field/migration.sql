-- One Piece steg 1 (2026-11-10): vilket kortspel en produkt/ett set hör till.
-- Additivt: alla befintliga rader blir POKEMON via default. Idempotent.
DO $$ BEGIN
  CREATE TYPE "Game" AS ENUM ('POKEMON', 'ONE_PIECE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "game" "Game" NOT NULL DEFAULT 'POKEMON';
ALTER TABLE "CardSet" ADD COLUMN IF NOT EXISTS "game" "Game" NOT NULL DEFAULT 'POKEMON';
CREATE INDEX IF NOT EXISTS "Product_game_idx" ON "Product"("game");
