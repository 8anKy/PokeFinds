-- Samlingsvärdet fryses en gång per natt efter cardmarket-refresh (settle-collection-values).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "settledValueOre" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "settledValueFromCm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "settledValueAt" TIMESTAMP(3);
