-- Butiks-hälsokollens fynd: veckans backlog ur store-health.yml, läses av /admin/halsokoll.
-- Idempotent (IF NOT EXISTS) — kan köras om utan skada.
CREATE TABLE IF NOT EXISTS "StoreHealthFinding" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "url" TEXT,
    "offerId" TEXT,
    "productSlug" TEXT,
    "retailer" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreHealthFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StoreHealthFinding_section_idx" ON "StoreHealthFinding"("section");
