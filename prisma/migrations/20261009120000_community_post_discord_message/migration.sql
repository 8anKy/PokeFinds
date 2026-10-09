-- Köp/sälj/byt-annonsernas spegel i Discord (lib/discord-market.ts). Nullbar:
-- befintliga annonser har aldrig postats och ska inte postas i efterhand.
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "discordMessageId" TEXT;
