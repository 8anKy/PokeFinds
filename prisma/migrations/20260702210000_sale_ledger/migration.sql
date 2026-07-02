-- CreateTable
CREATE TABLE IF NOT EXISTS "Sale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setName" TEXT,
    "imageUrl" TEXT,
    "condition" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "purchasePriceOre" INTEGER,
    "salePriceOre" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "traderaItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Sale_userId_soldAt_idx" ON "Sale"("userId", "soldAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
