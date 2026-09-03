-- Forum med grupper + Köp/Sälj/Byt + bilder, 1:1-meddelanden, Tradera-annonser på
-- profilen (2026-09-03). Idempotent (IF NOT EXISTS / DO-vakter / ON CONFLICT) —
-- kan köras om utan skada. ⛔ Migrationen MÅSTE ligga före koden i prod
-- (`node scripts/with-prod-db.mjs npx prisma migrate deploy` FÖRE push).

-- ---------- Profil: visa Tradera-annonser (egen spak, default av) ----------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showTraderaListings" BOOLEAN NOT NULL DEFAULT false;

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE "ListingKind" AS ENUM ('SELL', 'BUY', 'TRADE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Grupper ----------
CREATE TABLE IF NOT EXISTS "CommunityGroup" (
  "id"            TEXT NOT NULL,
  "slug"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "emoji"         TEXT,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "isMarketplace" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommunityGroup_slug_key" ON "CommunityGroup"("slug");

CREATE TABLE IF NOT EXISTS "CommunityGroupMember" (
  "groupId"   TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityGroupMember_pkey" PRIMARY KEY ("groupId", "userId")
);
CREATE INDEX IF NOT EXISTS "CommunityGroupMember_userId_idx" ON "CommunityGroupMember"("userId");
DO $$ BEGIN
  ALTER TABLE "CommunityGroupMember" ADD CONSTRAINT "CommunityGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CommunityGroupMember" ADD CONSTRAINT "CommunityGroupMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Kurerade startgrupper. Fasta id:n så att kod och seed kan peka på dem.
-- ON CONFLICT (slug) DO NOTHING → omkörning rör inte redigerade namn/beskrivningar.
INSERT INTO "CommunityGroup" ("id", "slug", "name", "description", "emoji", "sortOrder", "isMarketplace") VALUES
  ('grp_allmant',            'allmant',            'Allmänt',             'Allt som rör Pokémon TCG i Sverige: frågor, nyheter, spaningar och snack.', '💬', 10, false),
  ('grp_kop_salj_byt',       'kop-salj-byt',       'Köp, sälj & byt',     'Sälj, köp eller byt kort och sealed med andra samlare. Foilio är inte part i affären – ni gör upp direkt med varandra.', '🤝', 20, true),
  ('grp_samlingar_pulls',    'samlingar-pulls',    'Samlingar & pulls',   'Visa upp dina pulls, pärmar och samlingar.', '✨', 30, false),
  ('grp_sealed_slapp',       'sealed-slapp',       'Sealed & släpp',      'Nya set, förhandsbokningar, restocks och sealed-samlande.', '📦', 40, false),
  ('grp_skanning_gradering', 'skanning-gradering', 'Skanning & gradering','Skannern, AI-graderingen och riktig gradering (PSA, CGC, ACE).', '🔍', 50, false),
  ('grp_nyborjare',          'nyborjare',          'Nybörjare',           'Ny i hobbyn? Här finns inga dumma frågor.', '🌱', 60, false)
ON CONFLICT ("slug") DO NOTHING;

-- ---------- Trådar: grupp + marknadsfält + aktivitet ----------
ALTER TABLE "CommunityPost" ALTER COLUMN "category" DROP NOT NULL;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "groupId"        TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "listingKind"    "ListingKind";
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "listingStatus"  "ListingStatus";
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "priceOre"       INTEGER;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "condition"      TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "productId"      TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "traderaUrl"     TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CommunityPost_groupId_lastActivityAt_idx" ON "CommunityPost"("groupId", "lastActivityAt");
CREATE INDEX IF NOT EXISTS "CommunityPost_lastActivityAt_idx" ON "CommunityPost"("lastActivityAt");
CREATE INDEX IF NOT EXISTS "CommunityPost_listingStatus_lastActivityAt_idx" ON "CommunityPost"("listingStatus", "lastActivityAt");

-- Bakfyllnad av gamla, platta inlägg: aktivitet = senaste svar (annars skapad),
-- grupp = Samlingar & pulls för pulls/samlingar, annars Allmänt. Bara rader utan
-- grupp rörs → omkörning är en no-op.
UPDATE "CommunityPost" p
SET "lastActivityAt" = GREATEST(
  p."createdAt",
  COALESCE((SELECT MAX(c."createdAt") FROM "Comment" c WHERE c."postId" = p."id"), p."createdAt")
)
WHERE p."groupId" IS NULL;

UPDATE "CommunityPost"
SET "groupId" = CASE
  WHEN "category" IN ('PULLS', 'COLLECTIONS') THEN 'grp_samlingar_pulls'
  ELSE 'grp_allmant'
END
WHERE "groupId" IS NULL;

-- ---------- Bilder i trådar (Railway Bucket-nycklar) ----------
CREATE TABLE IF NOT EXISTS "PostImage" (
  "id"        TEXT NOT NULL,
  "postId"    TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "width"     INTEGER,
  "height"    INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostImage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PostImage_postId_idx" ON "PostImage"("postId");
DO $$ BEGIN
  ALTER TABLE "PostImage" ADD CONSTRAINT "PostImage_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Meddelanden ----------
CREATE TABLE IF NOT EXISTS "Conversation" (
  "id"            TEXT NOT NULL,
  "pairKey"       TEXT NOT NULL,
  "postId"        TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "lastPreview"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_pairKey_key" ON "Conversation"("pairKey");
DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ConversationParticipant" (
  "conversationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "lastReadAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId", "userId")
);
CREATE INDEX IF NOT EXISTS "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");
DO $$ BEGIN
  ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Message" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId"       TEXT,
  "body"           TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "UserBlock" (
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId")
);
CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");
DO $$ BEGIN
  ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey"
    FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey"
    FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ChatReport" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "reporterId"     TEXT NOT NULL,
  "reason"         TEXT NOT NULL,
  "status"         "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"     TIMESTAMP(3),
  CONSTRAINT "ChatReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChatReport_status_idx" ON "ChatReport"("status");
DO $$ BEGIN
  ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
