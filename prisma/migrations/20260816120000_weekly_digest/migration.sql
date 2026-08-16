-- VECKOBREVET (src/jobs/weekly-digest.ts).
--
-- 1) Dubblettspärr. Utan kolumnen skickas brevet varje natt så länge veckodagen
--    stämmer, och en omkörning av scrape-all samma dygn hade mejlat alla igen.
--    Stämplas EFTER lyckat utskick — ett tillfälligt mejlfel får inte tysta
--    användaren för hela veckan (samma regel som proExpiryNotifiedAt).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weeklyDigestSentAt" TIMESTAMP(3);

-- 2) `weekly` in i notisinställningarnas DEFAULT.
--    ⛔ Defaulten speglar NOTIFICATION_DEFAULTS i src/lib/notification-settings.ts.
--    Ändras det ena utan det andra får nya konton en annan grundinställning än
--    gamla — tyst, och synligt först när någon undrar varför hen inte fick brevet.
--    BEFINTLIGA rader rörs INTE: `parseNotificationSettings` defaultar en saknad
--    nyckel till true, så gamla konton beter sig identiskt utan en UPDATE över
--    hela tabellen (och behåller sitt val den dag de gör ett).
ALTER TABLE "User"
  ALTER COLUMN "notificationSettings"
  SET DEFAULT '{"email":true,"push":false,"allRestocks":false,"weekly":true}';
