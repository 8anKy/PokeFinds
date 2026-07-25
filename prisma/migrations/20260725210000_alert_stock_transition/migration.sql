-- Lagerövergången som utlöste larmet, så utskicket kan välja rätt copy.
-- RESTOCK täcker tre händelser som alla slutar "köpbar": påfyllning (OUT→IN),
-- släpp (PREORDER→IN) och öppnad förhandsbokning (OUT→PREORDER). Utskicket sker
-- EFTER skanningen, när offern redan står på sin nya status → skillnaden går inte
-- att återskapa där utan de här kolumnerna.
-- Nullable + inget default → additiv och omedelbar (ingen tabellomskrivning).
-- Befintliga rader behåller null och faller tillbaka på "åter i lager"-copyn.
ALTER TABLE "Alert" ADD COLUMN "fromStatus" "StockStatus";
ALTER TABLE "Alert" ADD COLUMN "toStatus" "StockStatus";
