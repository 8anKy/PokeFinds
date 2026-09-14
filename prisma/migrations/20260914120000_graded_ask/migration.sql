-- GRADERADE BEGÄRDA PRISER (2026-09-14). Bakgrunden bor i modellens doc-kommentar
-- (prisma/schema.prisma, `GradedAsk`). Idempotent — kan köras om utan skada.
--
-- ⛔ MIGRATIONEN MÅSTE LIGGA FÖRE KODEN I PROD
-- (`node scripts/with-prod-db.mjs npx prisma migrate deploy` FÖRE push):
-- produktdetaljen selectar `GradedAsk` för VARJE produkt, och en omigrerad
-- databas ger då 500 på alla produktsidor.

CREATE TABLE IF NOT EXISTS "GradedAsk" (
  "id"               TEXT NOT NULL,
  "productId"        TEXT NOT NULL,
  "source"           TEXT NOT NULL,
  "issuer"           TEXT NOT NULL,
  "gradeTenths"      INTEGER NOT NULL,
  "priceOre"         INTEGER NOT NULL,
  "originalMinor"    INTEGER NOT NULL,
  "originalCurrency" TEXT NOT NULL,
  "listingCount"     INTEGER NOT NULL,
  "url"              TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "itemId"           TEXT NOT NULL,
  "observedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GradedAsk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GradedAsk_productId_source_issuer_gradeTenths_key"
  ON "GradedAsk"("productId", "source", "issuer", "gradeTenths");
CREATE INDEX IF NOT EXISTS "GradedAsk_observedAt_idx" ON "GradedAsk"("observedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GradedAsk_productId_fkey'
  ) THEN
    ALTER TABLE "GradedAsk"
      ADD CONSTRAINT "GradedAsk_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gradedAskCheckedAt" TIMESTAMP(3);
