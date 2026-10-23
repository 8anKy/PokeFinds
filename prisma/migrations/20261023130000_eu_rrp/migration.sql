-- Tillverkarens rekommenderade pris i EU ("Rek. pris (EU)") ur prisleverantörens sealed-rad
-- (`msrp.eu`, EUR). Lagras i EUR-CENT, inte öre: talet är ett fast europris och kronbeloppet
-- räknas med dagens kurs vid visning. Idempotent.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "euRrpCents" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "euRrpAt" TIMESTAMP(3);
