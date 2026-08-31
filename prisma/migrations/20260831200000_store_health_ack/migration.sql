-- Kvittering av hälsokolls-fynd som admin bedömt korrekta ("offern är rätt").
-- Idempotent (IF NOT EXISTS) — kan köras om utan skada.
CREATE TABLE IF NOT EXISTS "StoreHealthAck" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "offerId" TEXT,
    "title" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreHealthAck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StoreHealthAck_key_key" ON "StoreHealthAck"("key");
