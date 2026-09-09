-- CSV-IMPORT AV SAMLINGEN (2026-09-10). Bakgrunden bor i modellernas
-- doc-kommentarer (prisma/schema.prisma). Idempotent (IF NOT EXISTS / DO-vakter)
-- — kan köras om utan skada.
--
-- ⛔ MIGRATIONEN MÅSTE LIGGA FÖRE KODEN I PROD
-- (`node scripts/with-prod-db.mjs npx prisma migrate deploy` FÖRE push):
-- ny kod som selectar `customTitle` mot en omigrerad databas ger 500 för ALLA
-- som öppnar sin samling, och Dockerfilens `migrate deploy || true` är avsiktligt
-- icke-blockerande och kan tiga ihjäl felet.

CREATE TABLE IF NOT EXISTS "CollectionImport" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "fileName"     TEXT NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'generic',
  -- SHA-256 över filens råa text. ⛔ Inte över filnamnet: "collection (1).csv"
  -- är samma fil som "collection.csv", och det är innehållet som fördubblar
  -- samlingen.
  "fingerprint"  TEXT NOT NULL,
  "rowCount"     INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Ångrad import. Raden behålls så att samma fil kan importeras om utan varning.
  "undoneAt"     TIMESTAMP(3),
  CONSTRAINT "CollectionImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CollectionImport_userId_createdAt_idx"
  ON "CollectionImport"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CollectionImport"
    ADD CONSTRAINT "CollectionImport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Namnet en post visar när den inte kunde bindas till katalogen.
ALTER TABLE "CollectionItem" ADD COLUMN IF NOT EXISTS "customTitle" TEXT;
-- Gruppnyckeln som gör "Ångra importen" möjlig.
ALTER TABLE "CollectionItem" ADD COLUMN IF NOT EXISTS "importId" TEXT;

CREATE INDEX IF NOT EXISTS "CollectionItem_importId_idx" ON "CollectionItem"("importId");

-- ⛔ SET NULL, aldrig CASCADE: att radera importraden får aldrig kunna radera
-- någons samling.
DO $$ BEGIN
  ALTER TABLE "CollectionItem"
    ADD CONSTRAINT "CollectionItem_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "CollectionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
