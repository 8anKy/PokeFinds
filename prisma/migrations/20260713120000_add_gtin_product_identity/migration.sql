-- GTIN: tillverkarens streckkod som exakt cross-store-nyckel.
-- Normaliserad till GTIN-14 (se src/lib/gtin.ts). 5 av 7 butiker publicerar den.
--
-- MEDVETET INGEN UNIQUE-CONSTRAINT på Product.gtin: befintliga katalogdubbletter
-- delar streckkod och skulle krocka direkt vid backfill. Krocken ÄR dubbletten vi
-- vill hitta (se scripts/gtin-report.ts), inte ett fel att krascha importen på.

ALTER TABLE "Product" ADD COLUMN "gtin" TEXT;
ALTER TABLE "Offer" ADD COLUMN "gtin" TEXT;
ALTER TABLE "StoreListing" ADD COLUMN "gtin" TEXT;

-- Uppslag "finns produkt med denna streckkod?" körs en gång per auto-importerad annons.
CREATE INDEX "Product_gtin_idx" ON "Product"("gtin");
-- Driver konflikt-/dubblettrapporterna (GROUP BY productId / gtin).
CREATE INDEX "Offer_gtin_idx" ON "Offer"("gtin");
