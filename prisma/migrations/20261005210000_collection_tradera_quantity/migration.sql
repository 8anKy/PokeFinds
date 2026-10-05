-- Antal exemplar av posten som en Tradera-annons gäller (NULL = äldre annons = 1).
ALTER TABLE "CollectionItem" ADD COLUMN IF NOT EXISTS "traderaQuantity" INTEGER;
