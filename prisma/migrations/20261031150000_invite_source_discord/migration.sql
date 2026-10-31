-- Inbjudningar: hur vännen kom in (länk/kod) + när vännen gick med i Discord via Scoutr som NY medlem.
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "discordJoinedAt" TIMESTAMP(3);
