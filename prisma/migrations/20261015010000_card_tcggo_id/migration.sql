-- Prisleverantörens eget kort-id (se schema.prisma, Card.tcggoId). Additiv, nullable.
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "tcggoId" INTEGER;
