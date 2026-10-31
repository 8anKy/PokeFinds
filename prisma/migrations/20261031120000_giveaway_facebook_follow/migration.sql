-- Giveaway: självdeklarerad Facebook-följning (ägarbeslut 2026-10-31, overifierad).
ALTER TABLE "GiveawayEntry" ADD COLUMN IF NOT EXISTS "facebookFollowedAt" TIMESTAMP(3);
