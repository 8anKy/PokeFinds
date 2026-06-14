-- Kortnummer är inte unikt inom ett set (t.ex. Celebrations Classic Collection
-- har fyra kort med nummer 15). Byt identitetsnyckel till globalt unikt
-- tcgExternalId och gör (setId, number, language) till ett vanligt index.

-- DropIndex
DROP INDEX "Card_setId_number_language_key";

-- CreateIndex
CREATE UNIQUE INDEX "Card_tcgExternalId_key" ON "Card"("tcgExternalId");

-- CreateIndex
CREATE INDEX "Card_setId_number_language_idx" ON "Card"("setId", "number", "language");
