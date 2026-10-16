-- "Något fel?" på produktsidan (2026-10-16). Idempotent.
DO $$ BEGIN
  CREATE TYPE "ProductReportKind" AS ENUM ('WRONG_PRICE', 'WRONG_IMAGE', 'WRONG_INFO', 'DUPLICATE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProductReport" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "reporterId" TEXT,
  "kind" "ProductReportKind" NOT NULL,
  "note" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ProductReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductReport_status_idx" ON "ProductReport"("status");
CREATE INDEX IF NOT EXISTS "ProductReport_productId_idx" ON "ProductReport"("productId");

DO $$ BEGIN
  ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
