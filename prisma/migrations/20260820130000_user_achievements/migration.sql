-- UTMÄRKELSER (UserAchievement) — en rad per (användare, märke, nivå) som delats ut.
-- Se ///-blocken på modellen i schema.prisma för hela resonemanget. I korthet:
--
--   key          STABIL SLUG, aldrig översatt text. Namn/beskrivning slås upp i i18n
--                via katalogen i src/lib/achievements.ts. Text här hade låst märket
--                till användarens språk vid utdelningstillfället, och en omformulering
--                av copyn hade blivit en datamigration.
--   tier         1/2/3 för trappade märken (samlare 10 → 100 → 1 000). EGEN RAD per
--                nivå — nivåerna låstes upp vid olika tillfällen, och unlockedAt ska
--                vara sant för var och en.
--   announcedAt  ⛔ STÄMPLAS EFTER LYCKAT UTSKICK, ALDRIG FÖRE. Samma regel som
--                User.weeklyDigestSentAt: stämplas den innan mejlet gått iväg tystar
--                ett TILLFÄLLIGT mejlfel användaren för alltid — märket räknas som
--                meddelat och tas aldrig upp igen.
--   meta         Ögonblicksbild av skälet ({ setId, setName } / { value }). Att härleda
--                det i efterhand är en känd fälla här (jfr Alert.reasonSetName): setet
--                kan ha bytt namn och posterna kan vara sålda, och då påstår UI:t fel
--                anledning med full självsäkerhet. Skälet skrivs när beslutet fattas.
--
-- IF NOT EXISTS överallt: migrationerna måste TÅLA OMKÖRNING. Advisory-låset kan
-- timeouta mot poolern (PgBouncer) och då körs `migrate deploy` om med
-- PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1 — se CLAUDE.md.
--
-- ⛔ FRÄMMANDE NYCKELN LIGGER INLINE, inte som ett eget ALTER TABLE: `ADD CONSTRAINT`
-- har inget IF NOT EXISTS och hade fällt varje omkörning. Inline ärver tabellsatsens
-- IF NOT EXISTS — antingen skapas båda, eller ingendera.
-- ON DELETE CASCADE: ett raderat konto får inte lämna kvar utmärkelser som pekar på
-- ingen. GDPR-raderingen måste alltid fungera (CLAUDE.md, Regler).
CREATE TABLE IF NOT EXISTS "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcedAt" TIMESTAMP(3),
    "meta" JSONB,
    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ⛔ DET UNIKA INDEXET ÄR VAD SOM GÖR NATTJOBBET IDEMPOTENT. Svepet räknar om ALLA
-- användare varje natt och skriver med createMany({ skipDuplicates: true }); utan
-- indexet blir varje körning en ny dubblettrad och samma märke firas om varje natt.
-- ⛔ `tier` MÅSTE ingå: samlare 10/100/1000 är tre rader med samma (userId, key).
CREATE UNIQUE INDEX IF NOT EXISTS "UserAchievement_userId_key_tier_key"
    ON "UserAchievement"("userId", "key", "tier");

-- Läsvägen är alltid "vad har DEN HÄR användaren?" (/mer, profilsidan, veckobrevet).
CREATE INDEX IF NOT EXISTS "UserAchievement_userId_idx" ON "UserAchievement"("userId");
