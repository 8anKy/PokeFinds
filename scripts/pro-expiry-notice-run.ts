/**
 * CLI-wrapper för varningen om utgående gratis Pro (nattligt via scrape-all.yml,
 * eller manuellt). Kör: npx tsx scripts/pro-expiry-notice-run.ts
 *
 * ⛔ Utan RESEND_API_KEY hamnar mailern i console-läge och INGA mejl går ut —
 * körningen ser ändå grön ut. Se src/lib/mailer.ts.
 */
import * as fs from "fs";
import * as path from "path";

// Ladda .env manuellt (tsx auto-laddar inte, och vi undviker dotenv-beroende)
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { prisma } from "../src/lib/db";
import { runProExpiryNotice } from "../src/jobs/pro-expiry-notice";

runProExpiryNotice()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
