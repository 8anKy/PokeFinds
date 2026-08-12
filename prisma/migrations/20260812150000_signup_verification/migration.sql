-- Engångskoder för e-postverifiering FÖRE kontoskapande (registreringens
-- "Skicka kod"-steg). Bara hashen av koden lagras (se src/lib/tokens.ts).
--
-- Idempotent (IF NOT EXISTS) som resten av migrationerna i det här repot:
-- migrationen körs mot en levande prod-databas vid varje deploy.
CREATE TABLE IF NOT EXISTS "SignupVerification" (
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupVerification_pkey" PRIMARY KEY ("email")
);
