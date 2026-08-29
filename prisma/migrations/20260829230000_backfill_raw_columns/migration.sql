-- Product.lowestPriceOre och Card.cardmarketId lades till som RÅA ALTER i prod
-- (Railway-migrate-incidenten) och saknades i migrationshistoriken. Följd: varje
-- färsk databas (CI:s E2E-Postgres, en ny utvecklingsmiljö) saknade kolumnerna, och
-- /produkter loggade "column p.lowestPriceOre does not exist" på varje sidvisning —
-- röktesterna gick grönt av en slump tills 2026-08-29.
--
-- IF NOT EXISTS på båda: i prod är det en no-op (kolumner + index finns redan med
-- exakt de här namnen, kontrollerat mot pg_indexes 2026-08-29), i en tom databas
-- skapas de. Migrationen är därmed idempotent, som CLAUDE.md kräver.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lowestPriceOre" INTEGER;
CREATE INDEX IF NOT EXISTS "Product_lowestPriceOre_idx" ON "Product"("lowestPriceOre");

ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "cardmarketId" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Card_cardmarketId_key" ON "Card"("cardmarketId");
