-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'NEW_LISTING';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "storeListingId" TEXT;

-- CreateTable
CREATE TABLE "StoreListing" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" INTEGER,
    "imageUrl" TEXT,
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreListing_retailerId_idx" ON "StoreListing"("retailerId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreListing_retailerId_url_key" ON "StoreListing"("retailerId", "url");

-- AddForeignKey
ALTER TABLE "StoreListing" ADD CONSTRAINT "StoreListing_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_storeListingId_fkey" FOREIGN KEY ("storeListingId") REFERENCES "StoreListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

