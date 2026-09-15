-- Graderad prishistorik: en punkt per (produkt, källa, bolag, betyg, UTC-dygn).
CREATE TABLE IF NOT EXISTS "GradedAskSnapshot" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "gradeTenths" INTEGER NOT NULL,
  "date" DATE NOT NULL,
  "priceOre" INTEGER NOT NULL,
  "listingCount" INTEGER NOT NULL,
  CONSTRAINT "GradedAskSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GradedAskSnapshot_productId_source_issuer_gradeTenths_date_key"
  ON "GradedAskSnapshot"("productId", "source", "issuer", "gradeTenths", "date");
CREATE INDEX IF NOT EXISTS "GradedAskSnapshot_productId_date_idx" ON "GradedAskSnapshot"("productId", "date");
DO $$ BEGIN
  ALTER TABLE "GradedAskSnapshot" ADD CONSTRAINT "GradedAskSnapshot_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Seed: dagens punkt ur det tillstånd som redan finns, så grafen inte startar tom.
INSERT INTO "GradedAskSnapshot" ("id", "productId", "source", "issuer", "gradeTenths", "date", "priceOre", "listingCount")
SELECT 'seed_' || "id", "productId", "source", "issuer", "gradeTenths", ("observedAt" AT TIME ZONE 'UTC')::date, "priceOre", "listingCount"
FROM "GradedAsk"
ON CONFLICT DO NOTHING;
