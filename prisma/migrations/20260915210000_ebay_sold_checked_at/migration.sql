-- Rotation för eBay-sålda graderade (leverantörens ebay-sold-offers).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "ebaySoldCheckedAt" TIMESTAMP(3);
