-- Ägarens katalogborttagning UTAN radering: se Product.hiddenAt i schema.prisma.
--
-- Rak ADD COLUMN utan default → metadataändring i Postgres, ingen tabellomskrivning
-- och inget lås värt namnet ens på 31k rader.
--
-- Inget index med flit: villkoret är `hiddenAt IS NULL` för i praktiken hela tabellen,
-- dvs helt oselektivt — planeraren hade ändå valt seq scan, och en handkörd
-- prod-migration kostar mer än de millisekunder den skulle spara.
ALTER TABLE "Product" ADD COLUMN "hiddenAt" TIMESTAMP(3);
