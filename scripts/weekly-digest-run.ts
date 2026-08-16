/**
 * CLI-wrapper för veckobrevet (nattligt via scrape-all.yml — jobbet avgör själv om
 * det är rätt veckodag — eller manuellt).
 *
 *   npx tsx scripts/weekly-digest-run.ts                       # kör bara på rätt veckodag
 *   npx tsx scripts/weekly-digest-run.ts --dry-run --force     # bygg allt, skicka inget
 *   npx tsx scripts/weekly-digest-run.ts --force --to=du@x.se  # ETT skarpt provutskick
 *
 * ⛔ `--force` går förbi veckodagsvakten, ALDRIG förbi dubblettspärren
 * (`weeklyDigestSentAt`) — den är det som hindrar att alla får två brev.
 * ⛔ Utan RESEND_API_KEY vägrar jobbet skicka i stället för att tyst stämpla alla
 * som mejlade. Se src/jobs/weekly-digest.ts.
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
import { runWeeklyDigest } from "../src/jobs/weekly-digest";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const onlyEmail = process.argv.find((a) => a.startsWith("--to="))?.slice("--to=".length);

runWeeklyDigest(new Date(), { force, dryRun, onlyEmail })
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
