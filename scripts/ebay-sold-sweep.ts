/**
 * CLI-wrapper för svepet efter graderade SÅLDA eBay-affärer (leverantörens ebay-sold-offers).
 * Kärnlogiken bor i src/jobs/ebay-sold-sweep.ts (delas med workflow:en).
 *
 * Körs manuellt: npx tsx scripts/ebay-sold-sweep.ts
 * Env:  DRY_RUN=1                    Enbart rapport, inga DB-skrivningar
 *       TCGGO_EBAY_SOLD_DAILY_BUDGET=50  Antal kort (= RapidAPI-anrop) i körningen
 *
 * Mot prod-DB: node scripts/with-prod-db.mjs npx tsx scripts/ebay-sold-sweep.ts
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
import { exitJob } from "../src/lib/job-exit";
import { runEbaySoldSweep } from "../src/jobs/ebay-sold-sweep";

runEbaySoldSweep({ dryRun: process.env.DRY_RUN === "1" })
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => void exitJob());
