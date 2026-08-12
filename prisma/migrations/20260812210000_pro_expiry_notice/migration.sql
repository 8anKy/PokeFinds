-- Dubblettspärr för varningen "din gratis Pro-period tar snart slut"
-- (src/jobs/pro-expiry-notice.ts). Utan kolumnen mejlas samma användare varje natt
-- så länge hen ligger kvar i varningsfönstret.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "proExpiryNotifiedAt" TIMESTAMP(3);
