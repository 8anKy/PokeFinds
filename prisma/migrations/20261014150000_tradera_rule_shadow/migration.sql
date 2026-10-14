-- Tradera-kontrollens regeldom i SKUGGLÄGE bredvid LLM-domen (2026-10-14): samma par, båda domarna,
-- så de kan jämföras på NYA annonser innan reglerna tar över. Nullable — äldre rader saknar dem.
ALTER TABLE "TraderaMatch" ADD COLUMN IF NOT EXISTS "ruleOk" BOOLEAN;
ALTER TABLE "TraderaMatch" ADD COLUMN IF NOT EXISTS "ruleReason" TEXT;
ALTER TABLE "TraderaMatch" ADD COLUMN IF NOT EXISTS "listingTitle" TEXT;
