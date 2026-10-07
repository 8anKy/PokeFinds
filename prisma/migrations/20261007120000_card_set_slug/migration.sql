-- Läsbara set-adresser (src/lib/set-slug.ts). Nullbar: backfillen fyller den, och
-- setsidan tar emot id:t tills dess.
ALTER TABLE "CardSet" ADD COLUMN IF NOT EXISTS "slug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CardSet_slug_key" ON "CardSet"("slug");
