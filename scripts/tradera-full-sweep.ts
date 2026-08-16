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
import { verifyTraderaMatches } from "../src/jobs/verify-deals";

runTraderaSweep({
  dryRun: process.env.DRY_RUN === "1",
  expiryDays: parseInt(process.env.EXPIRY_DAYS ?? "3", 10),
})
  // EFTER svepet, LLM-verifiering av matchningen (fel här får inte fälla svepet
  // som redan lyckats): dölj felmatchade sealed-offers ÖVERALLT på sajten.
  //
  // ⛔ `verifyDeals()` kördes här t.o.m. 2026-08-16 och är AVSTÄNGD på ägarbeslut:
  // Fynd-ytan togs ur katalogfiltret 2026-07-21 och ingen länk i appen pekar på
  // `?sort=deals` längre, så varje natt betalade vi ett Tradera-GetItem plus en
  // LLM-dom per kandidat för en tabell (DealCheck) som ingen läste. Funktionen är
  // KVAR i src/jobs/verify-deals.ts — läs kommentaren där innan den kopplas in igen.
  .then(() => verifyTraderaMatches().catch((e) => console.error("[verify-matches] fel:", e)))
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
