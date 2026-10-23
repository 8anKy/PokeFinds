-- Pris per skick (2026-10-23): lägsta ENGELSKA CardTrader-annons per skick för produktens
-- tryckning, { "<CardCondition>": { "ore": n, "n": antal } }. Skrivs av reverse-passet i
-- cardtrader-refresh (lib/condition-prices.ts). Aldrig rubrikpris/samlingsvärde. Idempotent.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "conditionPrices" JSONB;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "conditionPricesAt" TIMESTAMP(3);
