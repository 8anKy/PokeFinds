-- Set-komplettering: två nämnare, och en tredje kolumn som gör den andra kontrollerbar.
-- Se de tre ///-blocken på CardSet i schema.prisma för invarianterna.
--
--   totalCardsFull  pokemontcg.io:s `total` — hela setet inkl. secret rares (120, inte 84).
--                   ⛔ Ersätter INTE totalCards (= printedTotal), som skannern läser.
--   tcgdexId        TCGdex:s set-id ("me05"). De numrerar annorlunda än pokemontcg.io.
--   printingsTotal  master set-nämnaren: normal + holo + reverse + firstEd enligt TCGdex.
--                   Skrivs BARA när normal+holo === vårt kortantal (se importskriptet).
--
-- 0 = OKÄNT i båda talkolumnerna, samma konvention som totalCards redan bär. Japanska
-- set (95 st, noll kort hos oss) förblir 0 med flit och får ingen komplettering.
--
-- NOT NULL DEFAULT 0 på en int är en ren metadataändring i Postgres 11+ — ingen
-- tabellomskrivning, inget lås värt namnet på 271 rader. IF NOT EXISTS för att våra
-- migrationer måste tåla omkörning (advisory-låset kan timeouta mot poolern).
-- Inga index: kolumnerna läses per redan hämtad set-rad, aldrig som filter.
ALTER TABLE "CardSet" ADD COLUMN IF NOT EXISTS "totalCardsFull" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CardSet" ADD COLUMN IF NOT EXISTS "tcgdexId" TEXT;
ALTER TABLE "CardSet" ADD COLUMN IF NOT EXISTS "printingsTotal" INTEGER NOT NULL DEFAULT 0;
