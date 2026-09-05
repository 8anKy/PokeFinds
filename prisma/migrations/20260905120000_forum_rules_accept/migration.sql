-- FORUMETS REGLER (2026-09-05): när användaren godkände forumreglerna i dialogen.
-- NULL = inte godkänt ⇒ inga trådar eller svar (grinden ligger i API-rutterna,
-- src/lib/forum-rules.ts). Idempotent — kan köras om utan skada. ⛔ Migrationen
-- MÅSTE ligga före koden i prod (`node scripts/with-prod-db.mjs npx prisma migrate
-- deploy` FÖRE push) — ny kod som selectar kolumnen mot en omigrerad databas ger 500.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "forumRulesAcceptedAt" TIMESTAMP(3);
