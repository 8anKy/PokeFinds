/**
 * CLI-wrapper för Tradera sålt-synk (tar bort sålda objekt ur samlingen).
 * Kärnlogiken bor i src/jobs/tradera-sold-sync.ts.
 *
 * Körs manuellt: npx tsx scripts/tradera-sold-sync.ts
 * Env: SOLD_LOOKBACK_DAYS=60
 */
import * as fs from "fs";
import * as path from "path";

// Ladda .env manuellt (tsx auto-laddar inte, undvik dotenv-beroende).
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { prisma } from "../src/lib/db";
import { runTraderaSoldSync } from "../src/jobs/tradera-sold-sync";

runTraderaSoldSync({ days: parseInt(process.env.SOLD_LOOKBACK_DAYS ?? "60", 10) })
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
