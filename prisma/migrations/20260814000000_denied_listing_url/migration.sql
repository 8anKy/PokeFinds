-- Denylistade butiks-URL:er satta från admin. Se schema.prisma för resonemanget.
-- Idempotent (IF NOT EXISTS) — samma mönster som repots övriga migrationer.
CREATE TABLE IF NOT EXISTS "DeniedListingUrl" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reason" TEXT,
    "productId" TEXT,
    "retailer" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeniedListingUrl_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeniedListingUrl_url_key" ON "DeniedListingUrl"("url");
CREATE INDEX IF NOT EXISTS "DeniedListingUrl_createdAt_idx" ON "DeniedListingUrl"("createdAt");
