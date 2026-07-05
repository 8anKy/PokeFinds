/**
 * CLI-wrapper för den dagliga Tradera-svepningen.
 * Kärnlogiken bor i src/jobs/tradera-sweep.ts (delas med jobb-workern).
 *
 * Körs manuellt: npx tsx scripts/tradera-full-sweep.ts
 * Env:  DRY_RUN=1       Enbart rapport, inga DB-ändringar
 *       EXPIRY_DAYS=3   Dagar utan återfunnen levande annons innan nollställning
 */
import * as fs from "fs";
import * as path from "path";

// Ladda .env manuellt (tsx auto-laddar inte, och vi undviker dotenv-beroende)
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { prisma } from "../src/lib/db";
import { runTraderaSweep } from "../src/jobs/tradera-sweep";
import { verifyDeals } from "../src/jobs/verify-deals";

runTraderaSweep({
  dryRun: process.env.DRY_RUN === "1",
  expiryDays: parseInt(process.env.EXPIRY_DAYS ?? "3", 10),
})
  // Verifiera fynd-kandidater (LLM) EFTER svepet — kandidatmängden är liten.
  // Fel här får inte fälla svepet (som redan lyckats).
  .then(() => verifyDeals().catch((e) => console.error("[verify-deals] fel:", e)))
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
