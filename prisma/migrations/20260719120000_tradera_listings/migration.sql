-- CreateTable
CREATE TABLE "TraderaListing" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraderaListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TraderaListing_productId_itemId_key" ON "TraderaListing"("productId", "itemId");

-- CreateIndex
CREATE INDEX "TraderaListing_productId_lastSeenAt_idx" ON "TraderaListing"("productId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "TraderaListing_lastSeenAt_idx" ON "TraderaListing"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "TraderaListing" ADD CONSTRAINT "TraderaListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
