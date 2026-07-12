-- Verdict-cache för dedupe-stubs LLM-domar.
--
-- OBS: `prisma migrate diff` vill även lägga till Card.cardmarketId och
-- Product.lowestPriceOre här — de kolumnerna finns REDAN i prod (tillagda som råa
-- ALTER vid ett tidigare tillfälle, se Railway-migrate-incidenten) men saknas i
-- migrations-historiken. Att ta med dem här skulle spränga `migrate deploy` med
-- "column already exists". Den här migrationen innehåller därför BARA den nya tabellen.

-- CreateTable
CREATE TABLE "DedupeVerdict" (
    "productAId" TEXT NOT NULL,
    "productBId" TEXT NOT NULL,
    "titleA" TEXT NOT NULL,
    "titleB" TEXT NOT NULL,
    "same" BOOLEAN NOT NULL,
    "reason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DedupeVerdict_pkey" PRIMARY KEY ("productAId","productBId")
);

-- CreateIndex
CREATE INDEX "DedupeVerdict_productBId_idx" ON "DedupeVerdict"("productBId");
