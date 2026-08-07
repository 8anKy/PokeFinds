-- Discord-koppling: länkar ett Foilio-konto till ett Discord-konto så att
-- Pro-rollen i vår server kan sättas/tas bort automatiskt.
--
-- Ingen OAuth-token lagras med flit (se schema.prisma) — användartoken används
-- en gång vid länkningen och slängs; rollhanteringen går via bot-token.
--
-- Idempotent (IF NOT EXISTS) som resten av kolumn-migrationerna i det här repot:
-- migrationen körs mot en levande prod-databas vid varje deploy.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "discordUserId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "discordUsername" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "discordLinkedAt" TIMESTAMP(3);

-- Ett Discord-konto får bära Pro från exakt ETT Foilio-konto. Utan detta kan
-- en enda prenumeration ge Pro-rollen via godtyckligt många konton.
-- NULL är inte unikt i Postgres, så olänkade konton påverkas inte.
CREATE UNIQUE INDEX IF NOT EXISTS "User_discordUserId_key" ON "User"("discordUserId");
