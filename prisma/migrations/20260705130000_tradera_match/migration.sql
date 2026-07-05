-- CreateTable
CREATE TABLE "TraderaMatch" (
    "itemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "reason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraderaMatch_pkey" PRIMARY KEY ("itemId","productId")
);

-- CreateIndex
CREATE INDEX "TraderaMatch_productId_idx" ON "TraderaMatch"("productId");
