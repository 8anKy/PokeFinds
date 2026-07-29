-- "Bäst matchning": kvalitetspoäng per produkt + trigram-sökning.
--
-- rankScore = qualityScore() × 1000 (src/services/ranking.ts), skriven en gång per
-- dygn av scrape-all. Kolumn i stället för beräkning vid läsning eftersom feeden
-- pagineras i SQL — en ordning som bara finns i minnet sorterar bara den sida vi
-- råkat hämta (samma skäl som Card.numberSortKey).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "rankScore" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Product_rankScore_idx" ON "Product"("rankScore");

-- pg_trgm: reserv när den exakta ordsökningen ger NOLL träffar ("charzard").
-- GIN-indexet gör dessutom att delsträngsmatchningen slipper seq-scanna 22k rader
-- (mätt före: seq scan, 213 buffers per sökning).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Product_normalizedTitle_trgm_idx"
  ON "Product" USING GIN ("normalizedTitle" gin_trgm_ops);
