-- Rekommenderat pris (MSRP) i öre per produkt — jämförelsepunkt för Discord-inlägget.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "msrpOre" INTEGER;
