-- Lägg-i-korgen-länk per offer (Shopify/WooCommerce). Idempotent.
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "cartUrl" TEXT;
