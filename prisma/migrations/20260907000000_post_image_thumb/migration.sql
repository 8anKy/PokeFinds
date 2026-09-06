-- Miniatyr för trådlistan. Nullable: befintliga bilder saknar en och faller
-- tillbaka på originalet (services/community.ts, signImages).
ALTER TABLE "PostImage" ADD COLUMN IF NOT EXISTS "thumbKey" TEXT;
