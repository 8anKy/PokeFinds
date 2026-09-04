-- GRADERADE FÖRSÄLJNINGAR (2026-09-04): vad någon faktiskt betalade för en slab,
-- nyckelat på (produkt, bolag, betyg). Bakgrund i modellens doc-kommentar
-- (prisma/schema.prisma) och i src/lib/graded-listing.ts. Idempotent
-- (IF NOT EXISTS / DO-vakter) — kan köras om utan skada. ⛔ Migrationen MÅSTE
-- ligga före koden i prod (`node scripts/with-prod-db.mjs npx prisma migrate deploy`
-- FÖRE push) — ny kod som selectar tabellen mot en omigrerad databas ger 500.

CREATE TABLE IF NOT EXISTS "GradedSale" (
  "id"          TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "itemId"      TEXT NOT NULL,
  "issuer"      TEXT NOT NULL,
  -- Betyg × 10 (100 = 10,0 · 95 = 9,5). NULL = graderat men okänt betyg.
  -- ⛔ Aldrig 0: "0" skulle läsas som betyg noll i stället för "vet inte".
  "gradeTenths" INTEGER,
  "price"       INTEGER NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'SEK',
  "language"    "CardLanguage" NOT NULL DEFAULT 'EN',
  "title"       TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "soldAt"      TIMESTAMP(3) NOT NULL,
  "bidCount"    INTEGER,
  "verify"      TEXT NOT NULL,
  "source"      TEXT NOT NULL DEFAULT 'tradera',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GradedSale_pkey" PRIMARY KEY ("id")
);

-- ⛔ Idempotensnyckeln. Svepet ser samma avslutade annons varje körning
-- (lookback > körtakt); utan den hade en affär vägt in en gång per natt.
CREATE UNIQUE INDEX IF NOT EXISTS "GradedSale_itemId_key" ON "GradedSale"("itemId");

-- Läsvägen: produktsidan frågar alltid per (produkt, bolag, betyg).
CREATE INDEX IF NOT EXISTS "GradedSale_productId_issuer_gradeTenths_idx"
  ON "GradedSale"("productId", "issuer", "gradeTenths");
CREATE INDEX IF NOT EXISTS "GradedSale_soldAt_idx" ON "GradedSale"("soldAt");

DO $$ BEGIN
  ALTER TABLE "GradedSale"
    ADD CONSTRAINT "GradedSale_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
