-- Japanska set: språk + Cardmarket-expansion som identitet.
--
-- DEFAULT 'EN' gör befintliga 176 rader korrekta utan backfill: hela katalogen
-- kommer från pokemontcg.io, som bara har engelska set.
ALTER TABLE "CardSet" ADD COLUMN "language" "CardLanguage" NOT NULL DEFAULT 'EN';
ALTER TABLE "CardSet" ADD COLUMN "cmExpansionId" INTEGER;

CREATE UNIQUE INDEX "CardSet_cmExpansionId_key" ON "CardSet"("cmExpansionId");
CREATE INDEX "CardSet_language_idx" ON "CardSet"("language");
