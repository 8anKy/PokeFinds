-- Portföljgrafen fryses vid samma tillfälle som samlingsvärdet (2026-10-12):
-- produktens senaste prissnapshot VID frysningen = grafens ankare, så snapshots som
-- andra jobb skriver efteråt (butikssvep, hot-card, JP) inte flyttar kurvan.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "settledTrendOre" INTEGER;

-- Tidsstämplar för nattjobb som läsvägar behöver (en rad per nyckel).
CREATE TABLE IF NOT EXISTS "JobMarker" (
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobMarker_pkey" PRIMARY KEY ("key")
);
