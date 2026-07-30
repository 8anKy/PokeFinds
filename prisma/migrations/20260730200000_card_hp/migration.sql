-- Card.hp — kortets största tryckta tal, skannerns särskiljare när
-- samlarnumret (~3 px på skärmfoto) inte går att läsa. Null för
-- trainers/energi. Fylls av import-tcg-data.ts + scripts/backfill-card-hp.ts.
ALTER TABLE "Card" ADD COLUMN "hp" INTEGER;
