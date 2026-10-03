ALTER TABLE "CommunityStoreReport"
  ADD COLUMN "priceOre" INTEGER,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SEK';

ALTER TABLE "CommunityStoreReport"
  ADD CONSTRAINT "CommunityStoreReport_price_check"
  CHECK ("priceOre" IS NULL OR "priceOre" BETWEEN 1 AND 100000000);
