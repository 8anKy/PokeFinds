-- Discord-meddelandet som speglar rapporten i butikslarm-kanalen. Behövs för att
-- radering, moderering och GDPR-radering ska kunna ta bort spegeln också.
ALTER TABLE "CommunityStoreReport" ADD COLUMN IF NOT EXISTS "discordMessageId" TEXT;
