-- MEMO för auto-importens LLM-dom: vilken produkt en butiks-URL löstes till.
--
-- Utan den frågade ensureListingProduct Haiku om SAMMA URL var 10:e minut i evighet
-- (mätt 2026-08-14: 720 anrop/dygn, ~90 % av appens Anthropic-nota) eftersom en URL
-- som aldrig kan få en egen Offer aldrig heller slutade se ut som "ny".
--
-- Additiv och idempotent: alla befintliga rader får NULL = "inget memo än" och döms
-- en gång till, precis som i dag. Ingen backfill behövs.
ALTER TABLE "StoreListing" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "StoreListing" ADD COLUMN IF NOT EXISTS "productMatchTitle" TEXT;

CREATE INDEX IF NOT EXISTS "StoreListing_productId_idx" ON "StoreListing"("productId");

-- ON DELETE SET NULL: en raderad/mergad produkt nollar memot i databasen, så nästa
-- körning dömer om och binder till målet. Alternativet (dinglande id) hade gett ett
-- FK-fel i offer-skrivningen i stället — tyst, i en bakgrundsloop.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StoreListing_productId_fkey'
  ) THEN
    ALTER TABLE "StoreListing"
      ADD CONSTRAINT "StoreListing_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
