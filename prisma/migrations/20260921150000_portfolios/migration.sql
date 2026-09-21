-- Pärmar i samlingen (2026-09-21). Idempotent.
-- Standardpärmen = portfolioId NULL på posten; ingen backfill av CollectionItem behövs.
CREATE TABLE IF NOT EXISTS "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Portfolio_userId_idx" ON "Portfolio"("userId");

DO $$ BEGIN
  ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CollectionItem" ADD COLUMN IF NOT EXISTS "portfolioId" TEXT;

CREATE INDEX IF NOT EXISTS "CollectionItem_portfolioId_idx" ON "CollectionItem"("portfolioId");

DO $$ BEGIN
  ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- En standardpärm per befintlig användare; ärver den gamla "offentlig samling"-flaggan
-- så att ingen profil byter synlighet av migrationen.
INSERT INTO "Portfolio" ("id", "userId", "name", "isPublic", "isDefault", "createdAt", "updatedAt")
SELECT 'pf' || substr(md5(u."id"), 1, 22), u."id", 'Min samling', u."isPublicCollection", true, NOW(), NOW()
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Portfolio" p WHERE p."userId" = u."id" AND p."isDefault");
