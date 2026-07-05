-- CreateTable
CREATE TABLE "DealCheck" (
    "offerId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "checkedPrice" INTEGER NOT NULL,
    "listingTitle" TEXT,
    "reason" TEXT,
    "endsAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealCheck_pkey" PRIMARY KEY ("offerId")
);

-- AddForeignKey
ALTER TABLE "DealCheck" ADD CONSTRAINT "DealCheck_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
