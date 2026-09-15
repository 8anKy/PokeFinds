-- Gratiskontots restock-larm levereras fördröjt: tidigast-tidpunkt per larm.
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "notBefore" TIMESTAMP(3);
