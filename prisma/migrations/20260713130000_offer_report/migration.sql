-- Användaranmälan av felaktiga butikserbjudanden (fel produkt / fel pris / död länk).
-- En felaktig butikslänk är osynlig för våra vakter men helt synlig för användaren
-- som klickade på den. Rättning sker alltid mot rådata (Offer via ID).

CREATE TYPE "OfferReportReason" AS ENUM ('WRONG_PRODUCT', 'WRONG_PRICE', 'DEAD_LINK', 'OUT_OF_STOCK');

CREATE TABLE "OfferReport" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" "OfferReportReason" NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OfferReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfferReport_status_idx" ON "OfferReport"("status");
CREATE INDEX "OfferReport_offerId_idx" ON "OfferReport"("offerId");

ALTER TABLE "OfferReport" ADD CONSTRAINT "OfferReport_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Anonyma anmälningar tillåts (reporterId NULL) — signalen är viktigare än kontot.
ALTER TABLE "OfferReport" ADD CONSTRAINT "OfferReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
